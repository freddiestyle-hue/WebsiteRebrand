// Competitor contrast - the audit's "how you stack up" layer.
//
// Discovery is a REAL Claude query (so the memo line "AI models recommend
// these competitors" is literally true - the field-average=61 lesson: never
// present a synthetic comparison as a real one). The model reads the
// prospect's own homepage text and names 1-2 direct competitors; every
// candidate domain is then validated (resolves, not the prospect, not a
// subdomain) and scanned with the FAST subset only - no PageSpeed, no
// headless - so two competitors fit inside ~12s wall time.
//
// Fail-open everywhere: no key, no candidates, failed validation, failed
// scans -> null. The memo simply doesn't show the section. A missing
// comparison costs nothing; a wrong one costs the whole memo's credibility.

import Anthropic from '@anthropic-ai/sdk';
import { checkDeliverability } from './dns-check';
import { checkIndexedPages } from './serp';
import { detectTechStack } from './tech-stack-check';
import { checkAds } from './ads-check';
import { extractSocialIdentity } from './social-identity';

const DISCOVERY_MODEL = 'claude-haiku-4-5-20251001';
const DISCOVERY_TIMEOUT_MS = 15000;
const SCAN_FETCH_TIMEOUT_MS = 9000;

// Full browser UA everywhere: WAFs on SMB sites (Wix, Cloudflare, GoDaddy
// builders) block honest bot UAs - a valid competitor (roofsbydon.com) was
// rejected in validation because "RivettAudit/1.0" couldn't load the page.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

export interface CompetitorScan {
  domain: string;
  name: string;
  /** Why the model says a buyer would consider them - one short clause. */
  aiReason: string;
  emailAuthOk: boolean | null;     // DMARC present
  indexedPages: number | null;
  adsTotal: number | null;         // verified platforms only, summed
  adsBreakdown: string | null;     // "Google 3 + Meta 12"
  llmsTxt: boolean | null;
  schemaOk: boolean | null;        // any JSON-LD on homepage
  hasBookingPath: boolean | null;  // form / tel: / scheduler on homepage
  techCount: number | null;
  scannedAt: string;
}

export interface CompetitorContrast {
  slug: string;
  prospectHostname: string;
  discoveredBy: string;            // model id - provenance for the memo
  aiLine: string;                  // "Asked Claude who a buyer would consider..."
  competitors: CompetitorScan[];
  generatedAt: string;
}

interface Candidate { name: string; domain: string; reason: string }

const DISCOVERY_SYSTEM = `You are a market analyst. Given a company's homepage text, name the 2 most direct competitors a BUYER would also consider: same offering, same buyer, similar size where possible. Prefer companies of comparable scale over giant household names. Never invent companies; if you are not confident real direct competitors exist, return fewer or none.

Output JSON only:
{"competitors":[{"name":"...","domain":"example.com","reason":"one short clause on why a buyer would consider them"}]}`;

function extractReadableText(html: string): string {
  const noScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  return noScripts.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000);
}

function normalizeDomain(raw: string): string | null {
  const d = String(raw || '')
    .trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
  if (!/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return null;
  return d;
}

function rootOf(domain: string): string {
  const parts = domain.split('.');
  return parts.slice(-2).join('.');
}

/** Validate a candidate: parseable, not the prospect (or a relative of it),
 *  and the site actually answers with HTML that is not a parking lander. */
export async function validateCandidate(
  cand: Candidate,
  prospectHostname: string
): Promise<Candidate | null> {
  const domain = normalizeDomain(cand.domain);
  if (!domain) return null;
  const prospect = normalizeDomain(prospectHostname);
  if (!prospect) return null;
  if (rootOf(domain) === rootOf(prospect)) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), SCAN_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`https://${domain}`, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'user-agent': BROWSER_UA },
      });
      if (!res.ok) return null;
      const finalHost = new URL(res.url).hostname.toLowerCase().replace(/^www\./, '');
      if (rootOf(finalHost) === rootOf(prospect)) return null;
      const head = (await res.text()).slice(0, 20000).toLowerCase();
      // Parking landers (the capsaai.com lesson).
      if (/godaddy|sedoparking|parkingcrew|bodis|this domain (is|may be) for sale|hugedomains/.test(head)) return null;
      return { ...cand, domain: finalHost };
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

/** Ask Claude for direct competitors based on the prospect's own homepage. */
export async function discoverCompetitors(
  prospectHostname: string,
  homepageHtml: string
): Promise<{ candidates: Candidate[]; model: string } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const user = `Company website: ${prospectHostname}

Homepage text:
${extractReadableText(homepageHtml)}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DISCOVERY_TIMEOUT_MS);
    let raw = '';
    try {
      const res = await client.messages.create(
        {
          model: DISCOVERY_MODEL,
          max_tokens: 400,
          system: DISCOVERY_SYSTEM,
          messages: [{ role: 'user', content: user }],
        },
        { signal: ctrl.signal }
      );
      const block = res.content.find((b) => b.type === 'text');
      raw = block && block.type === 'text' ? block.text : '';
    } finally {
      clearTimeout(t);
    }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const list: Candidate[] = Array.isArray(parsed?.competitors)
      ? parsed.competitors
          .filter((c: any) => c && typeof c.name === 'string' && typeof c.domain === 'string')
          .map((c: any) => ({
            name: c.name.trim().slice(0, 60),
            domain: c.domain,
            reason: typeof c.reason === 'string' ? c.reason.trim().slice(0, 140) : '',
          }))
      : [];
    return { candidates: list.slice(0, 3), model: DISCOVERY_MODEL };
  } catch (e) {
    console.warn('[competitor-contrast] discovery failed', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Fast-subset scan: the checks that run in seconds and compare apples to
 *  apples with fields every prospect memo already shows. No PSI, no headless. */
export async function scanCompetitor(cand: Candidate): Promise<CompetitorScan | null> {
  let html = '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), SCAN_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`https://${cand.domain}`, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'user-agent': BROWSER_UA },
      });
      if (!res.ok) return null;
      html = (await res.text()).slice(0, 900_000);
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }

  const identity = extractSocialIdentity(html);
  const [deliv, serp, ads, llms] = await Promise.allSettled([
    checkDeliverability(cand.domain),
    checkIndexedPages(cand.domain),
    checkAds(cand.domain, identity),
    (async () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      try {
        const r = await fetch(`https://${cand.domain}/llms.txt`, { signal: ctrl.signal });
        return r.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(t);
      }
    })(),
  ]);

  const delivVal = deliv.status === 'fulfilled' ? deliv.value : null;
  const serpVal = serp.status === 'fulfilled' ? serp.value : null;
  const adsVal = ads.status === 'fulfilled' ? ads.value : null;
  const tech = detectTechStack(html, undefined);

  const adsCounted = adsVal
    ? [
        adsVal.googleActive != null ? `Google ${adsVal.googleActive}` : null,
        adsVal.metaActive != null ? `Meta ${adsVal.metaActive}` : null,
        adsVal.linkedinActive != null ? `LinkedIn ${adsVal.linkedinActive}` : null,
      ].filter(Boolean)
    : [];

  return {
    domain: cand.domain,
    name: cand.name,
    aiReason: cand.reason,
    emailAuthOk: delivVal ? delivVal.dmarcPresent : null,
    indexedPages: serpVal ? serpVal.totalIndexed : null,
    adsTotal: adsVal
      ? (adsVal.googleActive ?? 0) + (adsVal.metaActive ?? 0) + (adsVal.linkedinActive ?? 0)
      : null,
    adsBreakdown: adsCounted.length ? adsCounted.join(' + ') : null,
    llmsTxt: llms.status === 'fulfilled' ? llms.value : null,
    schemaOk: /application\/ld\+json/i.test(html),
    hasBookingPath:
      /href=["']tel:|calendly\.com|cal\.com\/|savvycal|<form[\s>]/i.test(html),
    techCount: tech?.detected?.length ?? null,
    scannedAt: new Date().toISOString(),
  };
}

/** Full pipeline: discover -> validate -> scan (both in parallel). */
export async function buildCompetitorContrast(
  slug: string,
  prospectHostname: string,
  prospectHomepageHtml: string
): Promise<CompetitorContrast | null> {
  const discovery = await discoverCompetitors(prospectHostname, prospectHomepageHtml);
  if (!discovery || discovery.candidates.length === 0) return null;

  const validated = (
    await Promise.all(discovery.candidates.map((c) => validateCandidate(c, prospectHostname)))
  ).filter((c): c is Candidate => c !== null).slice(0, 2);
  if (validated.length === 0) return null;

  const scans = (await Promise.all(validated.map((c) => scanCompetitor(c)))).filter(
    (s): s is CompetitorScan => s !== null
  );
  if (scans.length === 0) return null;

  const names = scans.map((s) => s.name).join(scans.length === 2 ? ' and ' : '');
  return {
    slug,
    prospectHostname,
    discoveredBy: discovery.model,
    aiLine: `Asked an AI model who a buyer comparing ${prospectHostname} would also consider: it named ${names}.`,
    competitors: scans,
    generatedAt: new Date().toISOString(),
  };
}
