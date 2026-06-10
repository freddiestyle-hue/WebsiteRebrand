// Social identity extraction - the prospect's OWN links, from their OWN site.
//
// The ads check can only trust platform lookups keyed off a verified
// advertiser identity (the recom.co incident: name-guess lookups returned
// Recombee's ads). The strongest identity source we have is the prospect's
// homepage: the Facebook/Instagram/LinkedIn/TikTok links in their footer are
// self-declared. This module fetches the homepage once and extracts them.

export interface SocialIdentity {
  facebookSlug: string | null;   // facebook.com/<slug>
  instagramHandle: string | null; // instagram.com/<handle>
  linkedinSlug: string | null;   // linkedin.com/company/<slug>
  tiktokHandle: string | null;   // tiktok.com/@<handle>
}

export const EMPTY_IDENTITY: SocialIdentity = {
  facebookSlug: null,
  instagramHandle: null,
  linkedinSlug: null,
  tiktokHandle: null,
};

// Paths on each platform that are features, not profiles.
const FB_JUNK = new Set([
  'sharer', 'sharer.php', 'share', 'share.php', 'plugins', 'dialog', 'tr',
  'login', 'login.php', 'hashtag', 'groups', 'events', 'pages', 'profile.php',
  'people', 'watch', 'reel', 'story.php', 'photo', 'photo.php', 'home.php',
  'policies', 'help', 'privacy', 'legal', 'business', 'marketplace', 'gaming',
]);
const IG_JUNK = new Set(['p', 'reel', 'reels', 'explore', 'share', 'stories', 'accounts', 'tv', 'direct']);

function countWins(candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  const tally = new Map<string, number>();
  for (const c of candidates) tally.set(c, (tally.get(c) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Pull self-declared social profile links out of raw homepage HTML. */
export function extractSocialIdentity(html: string): SocialIdentity {
  const fb: string[] = [];
  const ig: string[] = [];
  const li: string[] = [];
  const tt: string[] = [];

  for (const m of html.matchAll(/facebook\.com\/([A-Za-z0-9.\-_]{2,60})/gi)) {
    const slug = m[1].replace(/\.$/, '');
    if (!FB_JUNK.has(slug.toLowerCase())) fb.push(slug);
  }
  for (const m of html.matchAll(/instagram\.com\/([A-Za-z0-9._]{2,40})/gi)) {
    const h = m[1].replace(/\.$/, '');
    if (!IG_JUNK.has(h.toLowerCase())) ig.push(h);
  }
  for (const m of html.matchAll(/linkedin\.com\/company\/([A-Za-z0-9\-_%]{2,80})/gi)) {
    li.push(decodeURIComponent(m[1]));
  }
  for (const m of html.matchAll(/tiktok\.com\/@([\w.\-]{2,40})/gi)) {
    tt.push(m[1]);
  }

  return {
    facebookSlug: countWins(fb),
    instagramHandle: countWins(ig),
    linkedinSlug: countWins(li),
    tiktokHandle: countWins(tt),
  };
}

/** Fetch the prospect's homepage and extract their self-declared identities.
 *  Never throws - identity discovery failing must not break the audit. */
export async function fetchSocialIdentity(hostname: string): Promise<SocialIdentity> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(`https://${hostname}`, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) return EMPTY_IDENTITY;
    const html = (await res.text()).slice(0, 600_000);
    return extractSocialIdentity(html);
  } catch {
    return EMPTY_IDENTITY;
  } finally {
    clearTimeout(timer);
  }
}
