// DNS deliverability check via DNS-over-HTTPS. No API key.
//
// Queries Cloudflare's public DoH endpoint for the records that determine
// whether a domain's outbound mail looks legit to Gmail/Outlook/Apple:
//   - SPF (TXT v=spf1)
//   - DMARC (TXT at _dmarc.<domain>)
//   - MX (where mail is received)
//
// Returns null if the DoH request fails entirely. Individual record presence
// is independent (a domain can have MX but no DMARC, etc).
//
// All requests in parallel, 5-second budget. Mirrors the teardown Python
// `deliverability.py` module so memos generated either way agree.

export interface DeliverabilityResult {
  spfPresent: boolean | null;
  spfPolicy: string | null;
  dmarcPresent: boolean | null;
  dmarcPolicy: string | null;
  mxPresent: boolean | null;
  mxProvider: string | null;
  commentary: string | null;
}

const DOH_URL = 'https://cloudflare-dns.com/dns-query';
const DOH_TIMEOUT_MS = 5000;

async function dohQuery(name: string, type: 'TXT' | 'MX'): Promise<string[]> {
  const url = new URL(DOH_URL);
  url.searchParams.set('name', name);
  url.searchParams.set('type', type);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/dns-json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { Answer?: Array<{ data: string }> };
    return (data.Answer ?? []).map((a) => a.data);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function parseDmarcPolicy(txt: string): string | null {
  // TXT record content; Cloudflare returns it quoted ("v=DMARC1; p=reject;")
  const stripped = txt.replace(/^"|"$/g, '');
  const m = stripped.match(/[;\s]p=(\w+)/i);
  return m ? m[1].toLowerCase() : null;
}

function parseSpfPolicy(txt: string): string | null {
  // Get the "all" qualifier at the end: -all, ~all, ?all, +all
  const stripped = txt.replace(/^"|"$/g, '');
  const m = stripped.match(/([+\-~?])all\b/);
  return m ? m[0] : null;
}

function inferMxProvider(records: string[]): string | null {
  if (records.length === 0) return null;
  const joined = records.join(' ').toLowerCase();
  if (joined.includes('google')) return 'Google';
  if (joined.includes('outlook') || joined.includes('protection.outlook')) return 'Microsoft 365';
  if (joined.includes('mailgun')) return 'Mailgun';
  if (joined.includes('zoho')) return 'Zoho';
  if (joined.includes('amazonses')) return 'Amazon SES';
  if (joined.includes('protonmail')) return 'Proton';
  if (joined.includes('icloud')) return 'iCloud';
  if (joined.includes('mxroute')) return 'MXroute';
  if (joined.includes('fastmail')) return 'Fastmail';
  if (joined.includes('mail.de')) return 'mail.de';
  // Pull just the hostname from the first MX record (skip the priority number)
  const first = records[0].trim().split(/\s+/).slice(1).join(' ').replace(/\.$/, '');
  return first || null;
}

export async function checkDeliverability(hostname: string): Promise<DeliverabilityResult | null> {
  try {
    const [spfTxt, dmarcTxt, mx] = await Promise.all([
      dohQuery(hostname, 'TXT'),
      dohQuery(`_dmarc.${hostname}`, 'TXT'),
      dohQuery(hostname, 'MX'),
    ]);

    const spfRecord = spfTxt.find((r) => /v=spf1/i.test(r)) ?? null;
    const dmarcRecord = dmarcTxt.find((r) => /v=DMARC1/i.test(r)) ?? null;

    const result: DeliverabilityResult = {
      spfPresent: spfRecord !== null,
      spfPolicy: spfRecord ? parseSpfPolicy(spfRecord) : null,
      dmarcPresent: dmarcRecord !== null,
      dmarcPolicy: dmarcRecord ? parseDmarcPolicy(dmarcRecord) : null,
      mxPresent: mx.length > 0,
      mxProvider: inferMxProvider(mx),
      commentary: null,
    };

    // Build a one-line commentary aimed at an operator, not an engineer.
    const issues: string[] = [];
    if (!result.spfPresent) {
      issues.push('no SPF (your mail looks suspicious to Gmail and Outlook)');
    } else if (result.spfPolicy === '~all' || result.spfPolicy === '?all') {
      issues.push('SPF is permissive (mail providers ignore it as a signal)');
    }
    if (!result.dmarcPresent) {
      issues.push('no DMARC (anyone can spoof your domain)');
    } else if (result.dmarcPolicy === 'none') {
      issues.push('DMARC is monitor-only (spoofed mail still delivers)');
    }
    if (!result.mxPresent) {
      issues.push('no MX (you cannot receive mail)');
    }
    if (issues.length === 0) {
      result.commentary = `SPF, DMARC, and MX all present. Mail from ${hostname} lands in the inbox.`;
    } else {
      result.commentary = `${hostname}: ${issues.join('; ')}.`;
    }

    return result;
  } catch {
    return null;
  }
}
