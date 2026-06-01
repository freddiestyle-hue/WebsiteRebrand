# Shortlink API (Upgrade 13)

Every outbound channel — LinkedIn DMs, cold emails, manual outreach, Python scripts, future Twitter/SMS — mints a shortlink via this API instead of pasting raw URLs. Why:

1. **Short DMs.** `rivett.tech/r/k3x9` adds 12 chars instead of `?utm_source=linkedin_dm&utm_recipient=claire&utm_campaign=wave1` (~80 chars).
2. **Per-recipient attribution.** Each shortlink has its own KV record. `click_count > 1` = the recipient forwarded.
3. **Owned data.** Every click fires PostHog `short_link_clicked` server-side before the redirect — even bouncers get tracked.
4. **Swap destinations after send.** Update the KV record to redirect a shortlink to a different URL.
5. **Bot-filtered.** LinkedIn/Slack/Facebook unfurl bots don't count as human clicks.

---

## Endpoints

### `POST /api/r/create` — mint a shortlink

**Auth:** `Authorization: Bearer <RIVETT_AUDIT_TOKEN>` OR `<HQ_KEY>` (env vars). Browser callers from `/hq` can also use the `rivett_hq_key` cookie.

**Request:**

```json
{
  "target_url": "https://rivett.tech/audit/v3/spok-com",
  "campaign": "wave1",
  "recipient": "claire@beaphar.co.uk",
  "channel": "linkedin_dm",
  "created_by": "hq_outreach_queue",
  "custom_code": "claire-spok"
}
```

| Field | Required | Notes |
|---|---|---|
| `target_url` | **Yes** | Full http/https URL. Validated. |
| `campaign` | No | Free-form. Examples: `wave1`, `wave2`, `mental-health-q3`. ≤80 chars. |
| `recipient` | No | Identifier (slug, email, LinkedIn URL fragment). ≤120 chars. |
| `channel` | No | `linkedin_dm` / `cold_email` / `twitter_dm` / etc. Becomes `utm_source`. ≤60 chars. |
| `medium` | No | Becomes `utm_medium`. **Defaults to `outreach`** (DMs, cold email). Pass `social` for blog/organic posts so they are not mislabeled as outbound. ≤60 chars. |
| `created_by` | No | Who/what minted (`fred`, `hq_outreach_queue`, `python_gmail_script`). ≤60 chars. |
| `custom_code` | No | Vanity slug (`claire-spok`). Lowercase alphanumeric+hyphen, 2-32 chars. Fails if taken. |

**Response 200:**

```json
{ "short_url": "https://rivett.tech/r/k3x9", "code": "k3x9" }
```

**Response errors:**

- `400 bad_request` — invalid body, malformed target URL, etc.
- `401 unauthorized` — auth header or cookie missing/wrong
- `500 mint_failed` — KV unreachable, custom_code already taken, or 5 random collisions in a row

### `GET /r/{code}` — resolve a shortlink

Public endpoint. Looks up the code, fires PostHog `short_link_clicked`, appends UTMs, 302 redirects.

**On unknown code:** redirects to `/audit/v3` (the form landing) rather than 404. A typo in a DM doesn't dead-end a real prospect.

**UTM params appended on redirect:**

```
utm_source={channel}
utm_campaign={campaign}
utm_recipient={recipient}
utm_medium={medium, defaults to outreach}
via=shortlink
rl={code}
```

---

## Calling examples

### curl (Python, shell scripts, manual mint)

```bash
SHORT_RESPONSE=$(curl -s -X POST https://rivett.tech/api/r/create \
  -H "Authorization: Bearer $RIVETT_AUDIT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "target_url": "https://rivett.tech/audit/v3/spok-com",
    "campaign": "wave1",
    "recipient": "claire",
    "channel": "linkedin_dm",
    "created_by": "python_gmail_script"
  }')

SHORT_URL=$(echo "$SHORT_RESPONSE" | python3 -c "import json,sys;print(json.load(sys.stdin)['short_url'])")

echo "$SHORT_URL"
# https://rivett.tech/r/k3x9
```

### Python (requests)

```python
import os, requests

def mint_shortlink(target_url, recipient, campaign='wave1', channel='cold_email'):
    res = requests.post(
        'https://rivett.tech/api/r/create',
        headers={
            'Authorization': f'Bearer {os.environ["RIVETT_AUDIT_TOKEN"]}',
            'Content-Type': 'application/json',
        },
        json={
            'target_url': target_url,
            'recipient': recipient,
            'campaign': campaign,
            'channel': channel,
            'created_by': 'python_gmail_script',
        },
        timeout=5,
    )
    res.raise_for_status()
    return res.json()['short_url']

# Use in your Gmail draft generator:
audit_url = f'https://rivett.tech/audit/v3/{prospect["slug"]}'
short_url = mint_shortlink(audit_url, recipient=prospect['email'])
email_body = email_body.replace(audit_url, short_url)
```

### TypeScript (Astro components, server-side)

```ts
import { createShortLink } from '../../utils/shortlink';

const code = await createShortLink({
  target: 'https://rivett.tech/audit/v3/spok-com',
  campaign: 'wave1',
  recipient: 'claire',
  channel: 'linkedin_dm',
  created_by: 'some_component',
});
// code = 'k3x9' or null on failure
```

### Browser JS (in-page, uses cookie auth)

```js
const res = await fetch('/api/r/create', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  credentials: 'same-origin', // sends the rivett_hq_key cookie
  body: JSON.stringify({
    target_url: 'https://rivett.tech/audit/v3/spok-com',
    recipient: prospectSlug,
    campaign: 'wave1',
    channel: 'linkedin_dm',
  }),
});
const { short_url } = await res.json();
```

---

## Wired surfaces (as of 2026-05-28)

| Surface | Status | How |
|---|---|---|
| `/hq` Send Queue (LinkedIn DM) | ✅ Live | OutreachQueue.astro auto-shortens audit URLs on Send click |
| Python Gmail draft scripts | ⏳ TODO | Add `mint_shortlink()` to each script, replace audit URL before IMAP append |
| Manual outreach (Apollo Sequences) | ⏳ TODO | Mint via curl, paste short_url into template |
| Cold-email templates in /cold-email skill | ⏳ TODO | Update skill to call /api/r/create when prep'ing copy |

---

## Bot filter

These user agents are still redirected (so unfurl previews work) but logged separately in `bot_click_count` and skip the PostHog event:

```
linkedinbot, facebookexternalhit, facebot, slackbot, twitterbot,
whatsapp, telegrambot, discordbot, redditbot, tumblr, embedly,
iframely, preview, unfurl, bot/, crawler, spider, archive.org
```

Without this filter, every shared link would log 1-3 fake "clicks" from unfurl bots before any human sees it.

---

## KV schema

```
Key:    shortlink:{code}
Value:  {
  target:           string,            // full URL to redirect to
  campaign:         string | undefined,
  recipient:        string | undefined,
  channel:          string | undefined,
  created_by:       string | undefined,
  created_at:       string,            // ISO 8601
  click_count:      number,            // human clicks only
  first_click_at:   string | null,     // ISO 8601 of first human click
  last_click_at:    string | null,     // ISO 8601 of most recent human click
  bot_click_count:  number             // unfurl bot fetches, separated
}
TTL:    none (manual cleanup if storage becomes an issue)
```

To inspect a single record:

```bash
curl -s "$KV_REST_API_URL/get/shortlink:k3x9" -H "Authorization: Bearer $KV_REST_API_TOKEN" | python3 -m json.tool
```

To list / scan keys (use sparingly):

```bash
curl -s "$KV_REST_API_URL/scan/0/MATCH/shortlink:*/COUNT/100" -H "Authorization: Bearer $KV_REST_API_TOKEN"
```

---

## PostHog events fired

| Event | When | Properties |
|---|---|---|
| `short_link_clicked` | Server-side on /r/{code} hit (human UA only) | `rl_code`, `rl_target`, `rl_target_path`, `rl_campaign`, `rl_recipient`, `rl_channel`, `$ip`, `$user_agent`, `$referrer`, `source=shortlink_server` |
| `$pageview` (on destination) | Browser, after redirect | `utm_source`, `utm_campaign`, `utm_recipient`, `utm_medium`, `via=shortlink`, `rl={code}` (via URL params) |

The two events together give you the full click → land funnel per shortlink.

---

## Operator queries

```sql
-- Top clicked shortlinks (last 30 days)
SELECT
  properties.rl_code AS code,
  properties.rl_campaign AS campaign,
  properties.rl_recipient AS recipient,
  count() AS clicks,
  count(DISTINCT person_id) AS unique_visitors
FROM events
WHERE event = 'short_link_clicked'
  AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY code, campaign, recipient
ORDER BY clicks DESC
LIMIT 50
```

```sql
-- Forwarded-share signal: shortlinks with click_count > 1 = recipient shared
SELECT
  properties.rl_code AS code,
  properties.rl_recipient AS original_recipient,
  count() AS total_clicks,
  count(DISTINCT properties.$device_id) AS distinct_devices
FROM events
WHERE event = 'short_link_clicked'
  AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY code, original_recipient
HAVING distinct_devices >= 2
ORDER BY distinct_devices DESC
```

---

## Failure modes considered

| Scenario | Behaviour |
|---|---|
| KV unreachable on mint | Returns 500 `mint_failed`. Caller (OutreachQueue, Python script) falls back to long URL. |
| KV unreachable on resolve | Redirects to `/audit/v3` (fall-through). Logs error. |
| `custom_code` already taken | Returns 500 `mint_failed`. Caller can retry without custom_code. |
| 5 random collisions on generated code | Returns 500. Astronomically unlikely (~10^-24 with 1.7M slots and 10k existing). |
| PostHog event post timeout | 2s timeout, logged. Redirect still happens — user-facing flow not blocked. |
| LinkedIn/etc. unfurl bot fetch | Counts in `bot_click_count`, no PostHog event. Redirect still happens (preview card renders). |
| Operator clicks Send twice | Two shortlinks minted for the same prospect+target. Wasteful but not broken; click counts are per-shortlink. |
