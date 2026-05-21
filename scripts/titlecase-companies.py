#!/usr/bin/env python3
"""Title-cases shouty multi-word company names.

Rules:
- If a company name has spaces between mostly-uppercase tokens, it's a
  multi-word name shouting in caps (e.g. "SADOWSKI & COMPANY, LLC").
  Title-case it.
- If it has no spaces or is a clear acronym (e.g. "CBRE", "WFAA",
  "IEEE-USA"), leave alone.
- Preserves common suffixes like LLC, INC, CO, CORP, LTD as uppercase.

Updates both Company and Introduction DM fields per row.
"""
import json
import os
import re
import sys
import time
import urllib.request
import urllib.parse

PAT = os.environ['AIRTABLE_PAT'].strip()
BASE = 'appgYU8VToutChjSi'
TABLE = 'Advertisers'

PRESERVE_UPPER = {
    'LLC', 'INC', 'CO', 'CORP', 'LTD', 'USA', 'US', 'UK', 'EU',
    'II', 'III', 'IV', 'AG', 'BV', 'NV', 'AB', 'SA', 'PLC',
    'CFO', 'CEO', 'CTO', 'COO', 'CMO',
}

INTRO_TEMPLATE = (
    "Hey {first_name}, I ran growth for Nick Huber at Somewhere. "
    "Love what you're doing at {company} - had to say hi."
)


def smart_title_case(s: str) -> str:
    """Title-case multi-word company name preserving acronym suffixes."""
    # Tokenize by whitespace, but keep punctuation attached to tokens.
    tokens = re.split(r'(\s+)', s)
    out = []
    for tok in tokens:
        if not tok or tok.isspace():
            out.append(tok)
            continue
        # Strip trailing punctuation for case-check, restore after.
        bare = tok.rstrip(',.;:!?')
        suffix = tok[len(bare):]
        if bare.upper() in PRESERVE_UPPER:
            out.append(bare.upper() + suffix)
        else:
            # Title-case but preserve interior caps like "I.T."
            if '.' in bare and len(bare) <= 6:
                out.append(bare + suffix)
            else:
                out.append(bare.capitalize() + suffix)
    return ''.join(out)


def needs_title_case(company: str) -> bool:
    if not company:
        return False
    cleaned = re.sub(r'\b(LLC|INC|CORP|LTD|CO|USA|US|II|III|IV|AG|GmbH)\b', '', company, flags=re.IGNORECASE)
    letters = [c for c in cleaned if c.isalpha()]
    if not letters or len(letters) < 4:
        return False
    upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
    if upper_ratio < 0.7:
        return False
    # Only title-case if there are spaces in the cleaned name (multi-word
    # implies a real company name shouting, not an acronym).
    return bool(re.search(r'\s', cleaned.strip()))


def fetch_all():
    records = []
    offset = None
    while True:
        params = "fields%5B%5D=Company&fields%5B%5D=First+Name"
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


def main():
    records = fetch_all()
    print(f"Fetched {len(records)} records")

    updates = []
    for r in records:
        company = r['fields'].get('Company', '')
        if not needs_title_case(company):
            continue
        new_company = smart_title_case(company)
        if new_company == company:
            continue
        first_name = r['fields'].get('First Name', '').strip() or 'there'
        new_intro = INTRO_TEMPLATE.format(first_name=first_name, company=new_company)
        updates.append({
            'id': r['id'],
            'fields': {
                'Company': new_company,
                'Introduction DM': new_intro,
            },
        })

    print(f"Title-casing {len(updates)} companies")
    for u in updates[:5]:
        # Find original
        original = next((r['fields']['Company'] for r in records if r['id'] == u['id']), '')
        print(f"  {original} -> {u['fields']['Company']}")
    if len(updates) > 5:
        print(f"  ... and {len(updates) - 5} more")

    # Batch update.
    failures = 0
    for i in range(0, len(updates), 10):
        batch = updates[i:i + 10]
        url = f"https://api.airtable.com/v0/{BASE}/{urllib.parse.quote(TABLE)}"
        body = json.dumps({'records': batch}).encode()
        req = urllib.request.Request(
            url,
            data=body,
            headers={'Authorization': f'Bearer {PAT}', 'Content-Type': 'application/json'},
            method='PATCH',
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                json.load(r)
            print(f"  [{i + len(batch):>3}/{len(updates)}] OK")
        except Exception as e:
            failures += 1
            print(f"  [{i + len(batch):>3}/{len(updates)}] FAIL: {e}")
        time.sleep(0.25)

    print(f"\nDone. {failures} failures.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
