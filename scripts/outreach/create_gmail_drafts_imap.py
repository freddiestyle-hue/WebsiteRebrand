#!/usr/bin/env python3
"""
Create Gmail drafts via IMAP APPEND to [Gmail]/Drafts folder.
Uses fred@rivett.tech app password (NOT the personal gmail MCP).

Before append, every audit URL in the body is swapped for a /api/r/create
shortlink so each recipient gets a unique attribution code. Falls back to
the long URL on mint failure so a flaky shortener never blocks outreach.
"""
import imaplib, json, os, re, sys, time, urllib.error, urllib.request
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path

sys.path.insert(0, '/tmp')
from gmail_creds import GMAIL_USER, GMAIL_APP_PASSWORD

SHORTLINK_API = 'https://rivett.tech/api/r/create'
AUDIT_URL_RE = re.compile(r'https?://(?:www\.)?rivett\.tech/audit/v3/[a-z0-9\-]+')
DEFAULT_CAMPAIGN = os.environ.get('SHORTLINK_CAMPAIGN', 'cold_email')


def load_audit_token():
    """Read RIVETT_AUDIT_TOKEN from website .env.local, same pattern as generate_remote_drafts_v5.py."""
    if os.environ.get('RIVETT_AUDIT_TOKEN'):
        return os.environ['RIVETT_AUDIT_TOKEN']
    env_path = Path.home() / 'Workspace/rivett/website/.env.local'
    if not env_path.exists():
        return None
    for line in env_path.read_text().splitlines():
        if line.startswith('RIVETT_AUDIT_TOKEN'):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    return None


def mint_shortlink(token, target_url, recipient, campaign=DEFAULT_CAMPAIGN, channel='cold_email'):
    """Return short_url or None on any failure. Caller must fall back."""
    payload = json.dumps({
        'target_url': target_url,
        'recipient': recipient,
        'campaign': campaign,
        'channel': channel,
        'created_by': 'python_gmail_script',
    }).encode('utf-8')
    req = urllib.request.Request(
        SHORTLINK_API,
        data=payload,
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
            return data.get('short_url')
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError) as e:
        print(f"    mint_failed ({type(e).__name__}: {e}) — falling back to long URL", file=sys.stderr)
        return None


def shorten_audit_urls(body, token, recipient, campaign):
    """Mint one shortlink per distinct audit URL in body, swap inline. Returns (new_body, swap_count)."""
    if not token:
        return body, 0
    urls = list(dict.fromkeys(AUDIT_URL_RE.findall(body)))  # unique, ordered
    swaps = 0
    for url in urls:
        short = mint_shortlink(token, url, recipient, campaign=campaign)
        if short:
            body = body.replace(url, short)
            swaps += 1
    return body, swaps


def build_draft_message(to_email, subject, body):
    msg = EmailMessage()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    msg['Subject'] = subject
    msg['Date'] = formatdate(localtime=True)
    msg['Message-ID'] = make_msgid(domain='rivett.tech')
    msg.set_content(body)
    return msg


def append_draft(imap, msg):
    raw = msg.as_bytes()
    # Gmail's Drafts folder name
    result = imap.append('[Gmail]/Drafts', '\\Draft', imaplib.Time2Internaldate(time.time()), raw)
    return result


def main():
    manifest = json.load(open('/tmp/gmail_draft_manifest.json'))
    print(f"Creating {len(manifest)} drafts under {GMAIL_USER}", file=sys.stderr)

    token = load_audit_token()
    if not token:
        print("  WARNING: no RIVETT_AUDIT_TOKEN found; drafts will keep long audit URLs", file=sys.stderr)
    else:
        print(f"  Shortener: campaign='{DEFAULT_CAMPAIGN}' (override via SHORTLINK_CAMPAIGN env var)", file=sys.stderr)

    # Connect to Gmail IMAP
    print(f"Connecting to imap.gmail.com:993...", file=sys.stderr)
    imap = imaplib.IMAP4_SSL('imap.gmail.com', 993)

    try:
        imap.login(GMAIL_USER, GMAIL_APP_PASSWORD)
    except imaplib.IMAP4.error as e:
        print(f"LOGIN FAILED: {e}", file=sys.stderr)
        print(f"Verify: 1) {GMAIL_USER} is correct 2) app password is from same account 3) IMAP is enabled in Gmail settings", file=sys.stderr)
        sys.exit(2)
    print(f"Logged in OK", file=sys.stderr)

    # Find Drafts folder (Workspace sometimes uses different name)
    typ, folders = imap.list()
    drafts_folder = None
    for f in folders:
        fs = f.decode() if isinstance(f, bytes) else f
        if '\\Drafts' in fs or '"Drafts"' in fs or '[Gmail]/Drafts' in fs:
            # Parse folder name out
            parts = fs.split(' "/" ')
            if len(parts) >= 2:
                drafts_folder = parts[-1].strip().strip('"')
                if '\\Drafts' in fs:
                    print(f"  Found drafts folder: {drafts_folder}", file=sys.stderr)
                    break
    if not drafts_folder:
        drafts_folder = '[Gmail]/Drafts'
        print(f"  Defaulting to {drafts_folder}", file=sys.stderr)

    written = 0
    failures = 0
    total_swaps = 0
    for i, item in enumerate(manifest, 1):
        try:
            body, swaps = shorten_audit_urls(
                item['body'],
                token=token,
                recipient=item['to'],
                campaign=item.get('campaign', DEFAULT_CAMPAIGN),
            )
            total_swaps += swaps
            msg = build_draft_message(item['to'], item['subject'], body)
            raw = msg.as_bytes()
            result, data = imap.append(drafts_folder, '\\Draft', imaplib.Time2Internaldate(time.time()), raw)
            short_tag = f" [+{swaps} short]" if swaps else ""
            if result == 'OK':
                written += 1
                print(f"  [{i:2d}/{len(manifest)}] OK{short_tag} -> {item['to'][:40]:<40} ({item['company']})", file=sys.stderr)
            else:
                failures += 1
                print(f"  [{i:2d}/{len(manifest)}] FAIL ({result}) -> {item['to']}: {data}", file=sys.stderr)
        except Exception as e:
            failures += 1
            print(f"  [{i:2d}/{len(manifest)}] EXCEPTION -> {item['to']}: {e}", file=sys.stderr)

    imap.logout()
    print(f"\nDone. Written={written}/{len(manifest)} Failures={failures} Shortlinks={total_swaps}", file=sys.stderr)


if __name__ == '__main__':
    main()
