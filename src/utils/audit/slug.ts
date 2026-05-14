const SUFFIX_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
// 16 chars from 36-char alphabet = 36^16 ≈ 2^82 of entropy. Sufficient to
// resist online brute force: 1,000 guesses/sec would take ~10^14 years.
// The original 4-char suffix gave 1.7M (36^4) which fell to brute force in
// hours at modest rate-limit speeds. Codex flagged this pre-ship.
const SUFFIX_LENGTH = 16;

export function normalizeDomainForSlug(input: string): string {
  let raw = input.trim().toLowerCase();
  if (!raw) throw new Error('Empty domain');

  raw = raw.replace(/^https?:\/\//, '');
  raw = raw.replace(/^www\./, '');
  raw = raw.split('/')[0];
  raw = raw.split(':')[0];
  raw = raw.split('?')[0];
  raw = raw.replace(/\.+$/, '');

  if (!raw.includes('.')) throw new Error(`Domain missing TLD: ${input}`);

  return raw.replace(/\./g, '-');
}

export function randomSuffix(): string {
  const bytes = new Uint8Array(SUFFIX_LENGTH);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < SUFFIX_LENGTH; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    out += SUFFIX_CHARS[bytes[i] % SUFFIX_CHARS.length];
  }
  return out;
}

export function generateSlug(domain: string, suffix?: string): string {
  const normalized = normalizeDomainForSlug(domain);
  const suf = suffix ?? randomSuffix();
  if (!new RegExp(`^[a-z0-9]{${SUFFIX_LENGTH}}$`).test(suf)) {
    throw new Error(`Invalid suffix: ${suf}`);
  }
  return `${normalized}-${suf}`;
}

export const SLUG_PATTERN = new RegExp(`^[a-z0-9-]+-[a-z0-9]{${SUFFIX_LENGTH}}$`);

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

// Deterministic, idempotent slug for v3 audits. Same domain always produces
// the same slug, so /audit/v3/{slug} is shareable + cacheable. Unlike the
// random-suffix variant used by /audit/p/[slug], v3 audits are not secret -
// the operator wants to share them with prospects.
export const V3_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export function v3SlugFromDomain(domain: string): string {
  return normalizeDomainForSlug(domain);
}

export function isValidV3Slug(slug: string): boolean {
  if (slug.length === 0 || slug.length > 64) return false;
  return V3_SLUG_PATTERN.test(slug);
}
