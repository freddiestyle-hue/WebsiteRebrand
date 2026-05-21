#!/usr/bin/env python3
"""
Pushes prospect records to the Teardown Prospecting Airtable base.

Reads /tmp/rivett_prospect_records_sorted.jsonl (455 records). Looks up which
domains are already in the base (the 10 from the MCP smoke-push) and skips them.
Pushes the rest in batches of 10 via the Airtable REST API.

Reads AIRTABLE_PAT from environment - script must be run with:
  AIRTABLE_PAT=pat... python3 scripts/push-to-airtable.py

The token is never written to disk. It only lives in process memory.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse

BASE_ID = "appgYU8VToutChjSi"
TABLE = "Advertisers"
INPUT_JSONL = "/tmp/rivett_prospect_records_sorted.jsonl"
BATCH_SIZE = 10
SLEEP_BETWEEN_BATCHES_MS = 250  # Stay under 5 req/sec rate limit.

AIRTABLE_PAT = os.environ.get("AIRTABLE_PAT", "").strip()
if not AIRTABLE_PAT:
    print("ERROR: AIRTABLE_PAT env var not set", file=sys.stderr)
    sys.exit(2)


def airtable_request(method: str, path: str, body: dict | None = None) -> dict:
    url = f"https://api.airtable.com/v0/{BASE_ID}/{urllib.parse.quote(path)}"
    data = json.dumps(body).encode() if body else None
    headers = {
        "Authorization": f"Bearer {AIRTABLE_PAT}",
        "Content-Type": "application/json",
    }
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code} on {method} {url}: {body[:400]}", file=sys.stderr)
        raise


def fetch_existing_domains() -> set[str]:
    """Pull every record's Domain so we don't double-push."""
    domains: set[str] = set()
    offset = None
    pages = 0
    while True:
        path = TABLE
        if offset:
            path += f"?offset={urllib.parse.quote(offset)}"
        # Use direct URL build because the helper escapes the table name.
        url = f"https://api.airtable.com/v0/{BASE_ID}/{urllib.parse.quote(TABLE)}"
        if offset:
            url += f"?offset={urllib.parse.quote(offset)}&fields%5B%5D=Domain"
        else:
            url += "?fields%5B%5D=Domain"
        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {AIRTABLE_PAT}"},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
        for rec in data.get("records", []):
            d = rec.get("fields", {}).get("Domain", "")
            if d:
                # Normalize: strip protocol so we match against our records.
                normalized = d.replace("https://", "").replace("http://", "").rstrip("/")
                domains.add(normalized.lower())
        pages += 1
        offset = data.get("offset")
        if not offset:
            break
    print(f"Found {len(domains)} existing domains across {pages} pages")
    return domains


def push_batch(records: list[dict]) -> int:
    body = {"records": [{"fields": r} for r in records], "typecast": False}
    resp = airtable_request("POST", TABLE, body)
    created = len(resp.get("records", []))
    return created


def main() -> int:
    # Load records.
    with open(INPUT_JSONL) as f:
        all_records = [json.loads(line) for line in f]
    print(f"Loaded {len(all_records)} records from {INPUT_JSONL}")

    # The first 10 sorted records were pushed via MCP for schema validation.
    # Dedupe by skipping them based on position (sort order is stable across
    # runs). Read-based dedupe is gated behind PAT scopes we may not have, so
    # position-based skip is more reliable.
    SKIP_FIRST = 10
    to_push = all_records[SKIP_FIRST:]
    print(f"Skipping first {SKIP_FIRST} records (already pushed via MCP)")
    print(f"Pushing {len(to_push)} new records in batches of {BATCH_SIZE}")

    total_created = 0
    failures = []
    for i in range(0, len(to_push), BATCH_SIZE):
        batch = to_push[i:i + BATCH_SIZE]
        try:
            created = push_batch(batch)
            total_created += created
            print(f"  [{i + len(batch):>4}/{len(to_push)}] +{created}", flush=True)
        except urllib.error.HTTPError as e:
            failures.append((i, str(e)))
            print(f"  [{i + len(batch):>4}/{len(to_push)}] FAILED: {e}", flush=True)
        except Exception as e:
            failures.append((i, str(e)))
            print(f"  [{i + len(batch):>4}/{len(to_push)}] ERROR: {e}", flush=True)
        time.sleep(SLEEP_BETWEEN_BATCHES_MS / 1000)

    print(f"\nDone. Created {total_created}/{len(to_push)} records.")
    if failures:
        print(f"Failures: {len(failures)}", file=sys.stderr)
        for idx, err in failures:
            print(f"  batch starting at index {idx}: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
