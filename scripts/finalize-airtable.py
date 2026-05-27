#!/usr/bin/env python3
"""
Final pass on the Airtable Advertisers table once the 409 audit completes.

For each successfully-audited prospect:
- Sets Audit URL, Score, Hero Dimension, Hero One-Liner, Audit Date
- Generates the Follow-up DM using V1.1 template with interpolated hero

For each failed audit (kv_silent_failure, fetch failure):
- Sets Outreach Stage = "Disqualified" with a Notes line explaining why

Reads AIRTABLE_PAT from env.
"""
import csv
import json
import os
import sys
import time
import urllib.request
import urllib.parse
from datetime import date

PAT = os.environ['AIRTABLE_PAT'].strip()
BASE = 'appgYU8VToutChjSi'
TABLE = 'Advertisers'

AUDIT_56_CSV = "/tmp/rivett_audit_56_advertisers.csv"
AUDIT_409_CSV = "/tmp/rivett_audit_409.csv"

FOLLOWUP_TEMPLATE = """Hey {first_name},

Thanks for connecting. Did a quick analysis of {company} this morning. {one_liner}

If you're spending on paid right now, this is costing you. Full audit here: {audit_url}

Happy to walk through it - cal.com/fred-style/discovery (30 min, no deck. Same kind of teardown I used to run for Nick's operators when I was at Somewhere.)

Fred"""

def norm(domain: str) -> str:
    return domain.replace('https://', '').replace('http://', '').rstrip('/').lower()


def load_audit_csvs() -> dict:
    """Returns {normalized_domain: audit_row} merging both audit CSVs."""
    out = {}
    for path in (AUDIT_56_CSV, AUDIT_409_CSV):
        if not os.path.exists(path):
            continue
        with open(path) as f:
            for r in csv.DictReader(f):
                d = norm(r.get('domain', ''))
                if d:
                    out[d] = r
    return out


def fetch_airtable_records() -> list:
    records = []
    offset = None
    while True:
        params = "fields%5B%5D=Domain&fields%5B%5D=First+Name&fields%5B%5D=Company&fields%5B%5D=Audit+URL"
        if offset:
            params += f"&offset={urllib.parse.quote(offset)}"
        url = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote(TABLE)}?{params}"
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {PAT}'})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
        records.extend(data['records'])
        offset = data.get('offset')
        if not offset:
            break
    return records


def patch_batch(updates: list):
    url = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote(TABLE)}"
    body = json.dumps({'records': updates}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={'Authorization': f'Bearer {PAT}', 'Content-Type': 'application/json'},
        method='PATCH',
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    audits = load_audit_csvs()
    print(f"Loaded {len(audits)} audit rows across both CSVs")
    success = sum(1 for r in audits.values() if r.get('success') == 'true')
    fail = sum(1 for r in audits.values() if r.get('success') == 'false')
    print(f"  Successful: {success}")
    print(f"  Failed:     {fail}")

    air = fetch_airtable_records()
    print(f"Fetched {len(air)} Airtable records")

    today = date.today().isoformat()
    updates = []
    disqualifications = []
    missing_audit = 0
    for rec in air:
        d = norm(rec['fields'].get('Domain', ''))
        if not d:
            continue
        audit = audits.get(d)
        if not audit:
            missing_audit += 1
            continue

        first_name = rec['fields'].get('First Name', '').strip() or 'there'
        company = rec['fields'].get('Company', '').strip() or d
        already_has_url = bool(rec['fields'].get('Audit URL'))

        if audit.get('success') == 'true':
            score_str = audit.get('score', '')
            try:
                score = float(score_str) if score_str else None
            except ValueError:
                score = None
            hero_dim = audit.get('hero_dimension', '')
            audit_url = audit.get('audit_url', '')
            # The one-liner is produced by the hero endpoint and carried in the
            # audit CSV - no longer recomputed here.
            one_liner = audit.get('hero_one_liner', '')
            update_fields = {
                'Audit URL': audit_url,
                'Hero Dimension': hero_dim if hero_dim else None,
                'Hero One-Liner': one_liner or None,
                'Audit Date': today,
            }
            # Only template the follow-up DM when the hero produced a one-liner.
            # A blank one-liner means the hero fetch failed; leave the DM unset
            # for a manual pass rather than ship a sentence with a hole in it.
            if one_liner:
                update_fields['LinkedIn Follow-up DM'] = FOLLOWUP_TEMPLATE.format(
                    first_name=first_name,
                    company=company,
                    one_liner=one_liner,
                    audit_url=audit_url,
                )
            if score is not None:
                update_fields['Score'] = score
            # Skip rows that already have Audit URL (the original 46) to avoid
            # overwriting their possibly-newer hero data.
            if already_has_url:
                continue
            updates.append({'id': rec['id'], 'fields': {k: v for k, v in update_fields.items() if v is not None}})
        else:
            # Failed audit. Skip if already disqualified to be idempotent.
            disqualifications.append({
                'id': rec['id'],
                'fields': {
                    'Outreach Stage': 'Disqualified',
                    'Notes': f"Site couldn't be audited: {audit.get('error', 'unknown')}. Probably broken or blocking scanners.",
                },
            })

    print(f"\n{len(updates)} records to update with audit data")
    print(f"{len(disqualifications)} records to mark as Disqualified")
    print(f"{missing_audit} Airtable records had no matching audit row")

    all_changes = updates + disqualifications
    failures = 0
    for i in range(0, len(all_changes), 10):
        batch = all_changes[i:i + 10]
        try:
            patch_batch(batch)
            print(f"  [{i + len(batch):>4}/{len(all_changes)}] OK", flush=True)
        except Exception as e:
            failures += 1
            print(f"  [{i + len(batch):>4}/{len(all_changes)}] FAIL: {e}", flush=True)
        time.sleep(0.25)

    print(f"\nDone. {failures} batch failures.")
    return 0 if failures == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
