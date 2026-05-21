#!/usr/bin/env python3
"""
Bulk-updates the Introduction DM field on every Advertiser row in the
Teardown Prospecting base.

V2 template (Fred-locked 2026-05-19):
  Hey {first_name}, I ran growth for Nick Huber at Somewhere.
  Love what you're doing at {company}.

Reads AIRTABLE_PAT from env. Matches local prospect data to Airtable rows
by Domain (normalized: strip protocol + trailing slash).
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
SLEEP_MS = 250

PAT = os.environ.get("AIRTABLE_PAT", "").strip()
if not PAT:
    print("ERROR: AIRTABLE_PAT not set", file=sys.stderr)
    sys.exit(2)

NEW_INTRO_TEMPLATE = (
    "Hey {first_name}, I ran growth for Nick Huber at Somewhere. "
    "Love what you're doing at {company} - had to say hi."
)


def norm(domain: str) -> str:
    return domain.replace("https://", "").replace("http://", "").rstrip("/").lower()


def http(method: str, path: str, body=None):
    url = f"https://api.airtable.com/v0/{BASE_ID}/{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {PAT}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_all_records() -> list[dict]:
    """List records, pulling Domain + First Name + Company for matching."""
    records = []
    offset = None
    while True:
        params = "fields%5B%5D=Domain&fields%5B%5D=First+Name&fields%5B%5D=Company"
        if offset:
            params += f"&offset={urllib.parse.quote(offset)}"
        url = f"https://api.airtable.com/v0/{BASE_ID}/{urllib.parse.quote(TABLE)}?{params}"
        req = urllib.request.Request(
            url, headers={"Authorization": f"Bearer {PAT}"}
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
        records.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            break
    return records


def main() -> int:
    # Load local records by domain for fast lookup.
    local = {}
    with open(INPUT_JSONL) as f:
        for line in f:
            r = json.loads(line)
            d = norm(r.get("Domain", ""))
            if d:
                local[d] = r
    print(f"Loaded {len(local)} local records")

    # Pull every Airtable record.
    air = fetch_all_records()
    print(f"Fetched {len(air)} Airtable records")

    # Build update payloads. Use Airtable's First Name + Company from the
    # row itself (not the local file) so any manual edits Fred made in
    # Airtable take precedence over our local data.
    updates = []
    skipped_no_company = 0
    skipped_no_first_name = 0
    for rec in air:
        fields = rec.get("fields", {})
        first_name = fields.get("First Name", "").strip()
        company = fields.get("Company", "").strip()
        if not first_name:
            skipped_no_first_name += 1
            # Fall back to "there" so the DM still reads
            first_name = "there"
        if not company:
            skipped_no_company += 1
            continue
        new_dm = NEW_INTRO_TEMPLATE.format(first_name=first_name, company=company)
        updates.append({
            "id": rec["id"],
            "fields": {"Introduction DM": new_dm},
        })

    print(f"Prepared {len(updates)} updates "
          f"(skipped {skipped_no_company} without Company, "
          f"{skipped_no_first_name} without First Name)")

    # Batch update.
    failures = 0
    for i in range(0, len(updates), BATCH_SIZE):
        batch = updates[i:i + BATCH_SIZE]
        body = {"records": batch}
        try:
            resp = http("PATCH", urllib.parse.quote(TABLE), body)
            updated = len(resp.get("records", []))
            print(f"  [{i + len(batch):>4}/{len(updates)}] updated {updated}", flush=True)
        except urllib.error.HTTPError as e:
            failures += 1
            err_body = e.read().decode("utf-8", errors="replace")
            print(f"  [{i + len(batch):>4}/{len(updates)}] FAILED: HTTP {e.code} - {err_body[:300]}", flush=True)
        except Exception as e:
            failures += 1
            print(f"  [{i + len(batch):>4}/{len(updates)}] ERROR: {e}", flush=True)
        time.sleep(SLEEP_MS / 1000)

    print(f"\nDone. {failures} batch failures.")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
