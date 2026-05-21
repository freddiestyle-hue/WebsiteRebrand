#!/usr/bin/env python3
"""Remove duplicate Airtable records keyed by Domain.

Keeps the OLDEST record per domain (oldest createdTime) and deletes
the rest. We pick oldest because the older row was created during
the MCP batch_1 + first successful REST push - newer rows are
re-runs that landed before we noticed.

Dry-run by default. Pass --apply to actually delete.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse

PAT = os.environ['AIRTABLE_PAT'].strip()
BASE = 'appgYU8VToutChjSi'
TABLE = 'Advertisers'

APPLY = '--apply' in sys.argv


def fetch_all():
    records = []
    offset = None
    while True:
        params = "fields%5B%5D=Domain"
        if offset:
            params += f"&offset={urllib.parse.quote(offset)}"
        url = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote(TABLE)}?{params}"
        req = urllib.request.Request(
            url, headers={'Authorization': f'Bearer {PAT}'}
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
        records.extend(data['records'])
        offset = data.get('offset')
        if not offset:
            break
    return records


def delete_batch(ids: list[str]):
    """Airtable supports DELETE with up to 10 ids via records[] query params."""
    params = "&".join(f"records%5B%5D={urllib.parse.quote(i)}" for i in ids)
    url = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote(TABLE)}?{params}"
    req = urllib.request.Request(
        url,
        headers={'Authorization': f'Bearer {PAT}'},
        method='DELETE',
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    records = fetch_all()
    print(f"Total records: {len(records)}")

    by_domain: dict[str, list] = {}
    for r in records:
        d = (r['fields'].get('Domain') or '').lower()
        # Records with no domain go in a separate bucket so we can decide
        by_domain.setdefault(d, []).append(r)

    to_delete: list[str] = []
    kept_summary = []
    for d, rs in by_domain.items():
        if not d:
            # No-domain records - delete all
            for r in rs:
                to_delete.append(r['id'])
            kept_summary.append(f"no-domain: deleting {len(rs)}")
            continue
        if len(rs) == 1:
            continue
        # Sort by createdTime ASC, keep first (oldest), delete rest.
        rs_sorted = sorted(rs, key=lambda r: r.get('createdTime', ''))
        kept = rs_sorted[0]
        for r in rs_sorted[1:]:
            to_delete.append(r['id'])

    print(f"Domains: {len(by_domain)}")
    print(f"Records to delete: {len(to_delete)}")
    print(f"Records to keep:   {len(records) - len(to_delete)}")
    if kept_summary:
        for s in kept_summary[:5]:
            print(f"  {s}")

    if not APPLY:
        print("\nDRY RUN. Pass --apply to delete for real.")
        return 0

    print(f"\nDeleting {len(to_delete)} records in batches of 10...")
    deleted = 0
    for i in range(0, len(to_delete), 10):
        batch = to_delete[i:i + 10]
        try:
            resp = delete_batch(batch)
            n = len(resp.get('records', []))
            deleted += n
            print(f"  [{i + len(batch):>4}/{len(to_delete)}] deleted {n}", flush=True)
        except Exception as e:
            print(f"  [{i + len(batch):>4}/{len(to_delete)}] ERROR: {e}", flush=True)
        time.sleep(0.25)
    print(f"\nDeleted {deleted}/{len(to_delete)}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
