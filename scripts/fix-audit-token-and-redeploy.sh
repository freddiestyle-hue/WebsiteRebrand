#!/usr/bin/env bash
# One-shot fix for the audit token trailing-newline issue + prod redeploy.
#
# Background (from 2026-05-13 checkpoint):
#   echo "$VALUE" | vercel env add  → stored value has trailing \n (65 bytes)
#   Endpoint reads 65-byte value and rejects the local clean 64-byte token with 401.
#
# This script:
#   1. Removes the bad RIVETT_AUDIT_TOKEN from production
#   2. Re-adds it using `printf '%s'` so no trailing newline
#   3. Triggers a production deploy so the new env value takes effect
#   4. Smoke-tests /api/audit/check with the local token (expects 200)
#
# Run from anywhere:
#   bash ~/Workspace/rivett/website/scripts/fix-audit-token-and-redeploy.sh

set -euo pipefail

REPO="${HOME}/Workspace/rivett/website"
TOKEN_FILE="${HOME}/.gstack/rivett-audit-token.txt"

cd "$REPO"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "ERROR: clean token file not found at $TOKEN_FILE"
  exit 1
fi

TOKEN="$(cat "$TOKEN_FILE")"
TOKEN_BYTES="${#TOKEN}"
echo "==> local token: $TOKEN_BYTES bytes"

if [[ "$TOKEN_BYTES" -lt 32 ]]; then
  echo "ERROR: token looks too short ($TOKEN_BYTES bytes), aborting"
  exit 1
fi

echo "==> removing existing RIVETT_AUDIT_TOKEN from production"
vercel env rm RIVETT_AUDIT_TOKEN production --yes

echo "==> re-adding clean token to production (no newline)"
printf '%s' "$TOKEN" | vercel env add RIVETT_AUDIT_TOKEN production

echo "==> triggering production deploy"
vercel --prod

echo "==> waiting 10s for alias to flip"
sleep 10

echo "==> smoke testing /api/audit/check with local token"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST https://rivett.tech/api/audit/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}')

echo "==> /api/audit/check returned HTTP $RESPONSE"
if [[ "$RESPONSE" == "200" || "$RESPONSE" == "503" ]]; then
  # 200 = working. 503 = auth passed but Upstash unprovisioned (which is the OTHER blocker).
  echo "==> token fix CONFIRMED — auth no longer 401s"
  if [[ "$RESPONSE" == "503" ]]; then
    echo "    503 means Upstash Redis still needs provisioning via dashboard"
    echo "    https://vercel.com/dashboard → Storage → Marketplace → Upstash for Redis"
  fi
  exit 0
elif [[ "$RESPONSE" == "401" ]]; then
  echo "==> still 401 — something else is wrong, investigate"
  exit 1
else
  echo "==> unexpected status $RESPONSE — check Vercel logs"
  exit 1
fi
