// Tech-stack detection via curated fingerprint database.
//
// Inspired by Wappalyzer's open-source rules but trimmed to the ~150
// technologies that matter for B2B operator audits. Each signature
// matches against the already-fetched homepage HTML and response headers,
// so there's zero added latency.
//
// What this catches that engine.ts's narrow tracking detection misses:
//   - X (Twitter) Ads pixel via static.ads-twitter.com
//   - HubSpot Forms, HubSpot CMP, HubSpot Ads pixel
//   - LinkedIn Insight (snap.licdn.com)
//   - TikTok / Pinterest / Reddit / Snapchat pixels
//   - Consent management (OneTrust, Termly, Cookiebot)
//   - Customer support widgets (Intercom, Drift, Crisp)
//   - CMS detection (WordPress, Webflow, Framer)
//   - Hosting / framework signals (Vercel, Netlify, Next.js)
//
// What it STILL misses: tracking that GTM injects at runtime (those
// scripts don't appear in static HTML at all — that's Tier 2's job).

export type TechCategory =
  | 'analytics'
  | 'advertising'
  | 'tag-manager'
  | 'consent'
  | 'cms'
  | 'framework'
  | 'hosting'
  | 'cdn'
  | 'ecommerce'
  | 'forms-crm'
  | 'support'
  | 'email-marketing'
  | 'ab-testing'
  | 'reviews'
  | 'video'
  | 'scheduling'
  | 'fonts'
  | 'misc';

export interface TechSignature {
  name: string;
  category: TechCategory;
  scripts?: RegExp[];   // Match against <script src="..."> URLs
  html?: RegExp[];      // Match anywhere in HTML body
  headers?: Record<string, RegExp>; // header-name (lowercase) → value pattern
  meta?: Record<string, RegExp>;    // meta-name → content pattern
}

export interface DetectedTech {
  name: string;
  category: TechCategory;
  evidence: string;
}

const SIGNATURES: TechSignature[] = [
  // ─── Analytics ───────────────────────────────────────────────────────────
  {
    name: 'Google Analytics 4',
    category: 'analytics',
    scripts: [/googletagmanager\.com\/gtag\/js\?id=G-/i, /google-analytics\.com\/g\/collect/i],
    html: [/gtag\(['"]config['"],\s*['"]G-/i, /\bga\(['"]create['"],\s*['"]G-/i],
  },
  {
    name: 'Google Analytics (Universal)',
    category: 'analytics',
    scripts: [/google-analytics\.com\/analytics\.js/i, /google-analytics\.com\/ga\.js/i],
    html: [/\bga\(['"]create['"],\s*['"]UA-/i],
  },
  { name: 'Plausible', category: 'analytics', scripts: [/plausible\.io\/js\//i] },
  { name: 'Mixpanel', category: 'analytics', scripts: [/cdn\.mxpnl\.com\//i, /api(-js)?\.mixpanel\.com/i] },
  { name: 'Amplitude', category: 'analytics', scripts: [/cdn\.amplitude\.com\/.+amplitude/i] },
  { name: 'Heap', category: 'analytics', scripts: [/cdn\.heapanalytics\.com\//i, /heapanalytics\.com\/h\.js/i] },
  { name: 'Hotjar', category: 'analytics', scripts: [/static\.hotjar\.com\//i, /script\.hotjar\.com\//i] },
  { name: 'Microsoft Clarity', category: 'analytics', scripts: [/clarity\.ms\/tag\//i, /www\.clarity\.ms\//i] },
  { name: 'FullStory', category: 'analytics', scripts: [/edge\.fullstory\.com\//i, /fullstory\.com\/s\/fs\.js/i] },
  { name: 'Pendo', category: 'analytics', scripts: [/cdn\.pendo\.io\/agent\//i] },
  { name: 'PostHog', category: 'analytics', scripts: [/posthog\.com\/static\/array/i, /app\.posthog\.com\/static\//i, /us-assets\.i\.posthog\.com\//i, /eu-assets\.i\.posthog\.com\//i] },
  { name: 'Segment', category: 'analytics', scripts: [/cdn\.segment\.com\/analytics\.js\//i] },
  { name: 'Cloudflare Web Analytics', category: 'analytics', scripts: [/static\.cloudflareinsights\.com\//i] },
  { name: 'Fathom', category: 'analytics', scripts: [/cdn\.usefathom\.com\//i] },
  { name: 'Embedly', category: 'analytics', scripts: [/cdn\.embedly\.com\//i] },

  // ─── Advertising / Pixels ────────────────────────────────────────────────
  { name: 'Meta Pixel', category: 'advertising', scripts: [/connect\.facebook\.net\/[^\/]+\/fbevents\.js/i], html: [/fbq\(['"]init['"],/i] },
  { name: 'X (Twitter) Ads Pixel', category: 'advertising', scripts: [/static\.ads-twitter\.com\/uwt\.js/i, /analytics\.twitter\.com\//i] },
  { name: 'LinkedIn Insight Tag', category: 'advertising', scripts: [/snap\.licdn\.com\/li\.lms-analytics\//i], html: [/\b_linkedin_partner_id\s*=/i] },
  { name: 'TikTok Pixel', category: 'advertising', scripts: [/analytics\.tiktok\.com\/i18n\/pixel\//i, /ttq\.load/i], html: [/ttq\.load\(['"]/i] },
  { name: 'Pinterest Tag', category: 'advertising', scripts: [/s\.pinimg\.com\/ct\/core\.js/i], html: [/pintrk\(['"]load['"],/i] },
  { name: 'Reddit Pixel', category: 'advertising', scripts: [/www\.redditstatic\.com\/ads\/pixel\.js/i] },
  { name: 'Snapchat Pixel', category: 'advertising', scripts: [/sc-static\.net\/scevent\.min\.js/i] },
  { name: 'Quora Pixel', category: 'advertising', scripts: [/a\.quora\.com\/qevents\.js/i] },
  { name: 'Google Ads Conversion', category: 'advertising', html: [/googletagmanager\.com\/gtag\/js\?id=AW-/i, /gtag\(['"]config['"],\s*['"]AW-/i] },
  { name: 'HubSpot Ads Pixel', category: 'advertising', html: [/hsadspixel\.net\/fb/i, /\/_hsq\/.*PixelTracking/i] },

  // ─── Tag managers ────────────────────────────────────────────────────────
  { name: 'Google Tag Manager', category: 'tag-manager', scripts: [/googletagmanager\.com\/gtm\.js\?id=GTM-/i], html: [/GTM-[A-Z0-9]{4,}/] },
  { name: 'Segment (CDP)', category: 'tag-manager', scripts: [/cdn\.segment\.com\/analytics\.js\/v1\//i] },
  { name: 'Tealium iQ', category: 'tag-manager', scripts: [/tags\.tiqcdn\.com\//i] },

  // ─── Consent management ──────────────────────────────────────────────────
  { name: 'OneTrust', category: 'consent', scripts: [/cdn\.cookielaw\.org\//i, /cdn-apac\.onetrust\.com\//i] },
  { name: 'Cookiebot', category: 'consent', scripts: [/consent\.cookiebot\.com\//i] },
  { name: 'Termly', category: 'consent', scripts: [/app\.termly\.io\//i] },
  { name: 'Iubenda', category: 'consent', scripts: [/cdn\.iubenda\.com\//i] },
  { name: 'HubSpot CMP', category: 'consent', html: [/_hsp\.push/i, /usemessages\.com/i] },
  { name: 'Osano', category: 'consent', scripts: [/cmp\.osano\.com\//i] },

  // ─── CMS ─────────────────────────────────────────────────────────────────
  { name: 'WordPress', category: 'cms', html: [/wp-content\/themes\//i, /wp-content\/plugins\//i, /wp-includes\//i], meta: { generator: /^WordPress\b/i } },
  { name: 'Webflow', category: 'cms', headers: { 'x-wf-page-id': /.+/i, 'x-wf-cdn': /.+/i }, html: [/webflow\.com\/cdn\//i, /Webflow\.touch/i], meta: { generator: /^Webflow\b/i } },
  { name: 'Shopify', category: 'cms', headers: { 'x-shopify-stage': /.+/i, 'x-sorting-hat-shopid': /.+/i }, html: [/cdn\.shopify\.com\//i, /\bShopify\.locale\b/i] },
  { name: 'Squarespace', category: 'cms', html: [/static1\.squarespace\.com\//i, /Squarespace-Headers/i], meta: { generator: /^Squarespace\b/i } },
  { name: 'Wix', category: 'cms', html: [/static\.wixstatic\.com\//i, /wixsite\.com/i], headers: { 'x-wix-published-version': /.+/i } },
  { name: 'Framer', category: 'cms', html: [/framerusercontent\.com/i, /\bdata-framer-name=/i], meta: { generator: /^Framer\b/i } },
  { name: 'Ghost', category: 'cms', meta: { generator: /^Ghost\b/i }, html: [/ghost-sdk/i] },
  { name: 'HubSpot CMS', category: 'cms', headers: { 'x-hubspot-content-id': /.+/i }, html: [/hs-scripts\.com\//i, /\.hs-sites\.com\//i] },
  { name: 'Notion', category: 'cms', html: [/super\.so\//i, /potion\.so\//i] },
  { name: 'Cargo', category: 'cms', meta: { generator: /^Cargo\b/i } },
  { name: 'Sanity', category: 'cms', html: [/cdn\.sanity\.io\//i] },

  // ─── Frameworks ──────────────────────────────────────────────────────────
  { name: 'Next.js', category: 'framework', html: [/<script\s+id="__NEXT_DATA__"/i, /_next\/static\//i], headers: { 'x-nextjs-cache': /.+/i, 'x-powered-by': /^Next\.js/i } },
  { name: 'Nuxt', category: 'framework', html: [/<script[^>]*>window\.__NUXT__\s*=/i, /\/_nuxt\//i] },
  { name: 'Astro', category: 'framework', meta: { generator: /^Astro\b/i } },
  { name: 'Gatsby', category: 'framework', html: [/<script[^>]*>\s*window\.___gatsby\b/i, /\/page-data\//i] },
  { name: 'SvelteKit', category: 'framework', html: [/<script\b[^>]*>\s*__sveltekit/i] },
  { name: 'React', category: 'framework', html: [/data-reactroot\b/i, /<script[^>]+react(\.production)?\.min\.js/i] },
  { name: 'Vue', category: 'framework', html: [/<script[^>]+vue@/i, /\bdata-v-[0-9a-f]{8}\b/i] },
  { name: 'Angular', category: 'framework', html: [/\b_nghost-/i, /\bng-version=/i] },
  { name: 'Remix', category: 'framework', html: [/<script[^>]*>window\.__remixContext\b/i] },

  // ─── E-commerce ──────────────────────────────────────────────────────────
  { name: 'WooCommerce', category: 'ecommerce', html: [/wp-content\/plugins\/woocommerce\//i, /\bwoocommerce-/i] },
  { name: 'BigCommerce', category: 'ecommerce', headers: { 'x-bc-apache-version': /.+/i }, html: [/cdn[0-9]+\.bigcommerce\.com\//i] },
  { name: 'Magento', category: 'ecommerce', html: [/\/skin\/frontend\//i, /\bMage\.Cookies\b/i], headers: { 'x-magento-tags': /.+/i } },
  { name: 'Stripe (checkout)', category: 'ecommerce', scripts: [/js\.stripe\.com\/v3\//i, /js\.stripe\.com\/basil\//i] },
  { name: 'PayPal', category: 'ecommerce', scripts: [/www\.paypal\.com\/sdk\/js/i] },

  // ─── Forms / CRM ─────────────────────────────────────────────────────────
  { name: 'HubSpot Forms', category: 'forms-crm', scripts: [/js\.hsforms\.net\//i, /js\.hubspot\.com\/forms/i], html: [/hbspt\.forms\.create/i] },
  { name: 'HubSpot Tracking', category: 'forms-crm', scripts: [/js\.hs-scripts\.com\//i, /js\.hs-analytics\.net\//i] },
  { name: 'Marketo', category: 'forms-crm', scripts: [/munchkin\.marketo\.net\//i, /app-[a-z0-9]+\.marketo\.com\//i] },
  { name: 'Pardot (Salesforce)', category: 'forms-crm', scripts: [/pi\.pardot\.com\//i, /go\.pardot\.com\//i] },
  { name: 'Mailchimp', category: 'forms-crm', scripts: [/chimpstatic\.com\/mcjs-connected\//i, /[a-z0-9]+\.list-manage\.com\//i] },
  { name: 'Klaviyo', category: 'forms-crm', scripts: [/static\.klaviyo\.com\/onsite\//i, /a\.klaviyo\.com\/media\//i] },
  { name: 'ActiveCampaign', category: 'forms-crm', scripts: [/diffuser-cdn\.app-cloud\.private\.activecampaign\.com\//i] },
  { name: 'ConvertKit', category: 'forms-crm', scripts: [/convertkit\.com\/[^"]+\.js/i, /f\.convertkit\.com\//i] },
  { name: 'Typeform', category: 'forms-crm', scripts: [/embed\.typeform\.com\//i] },

  // ─── Customer support ────────────────────────────────────────────────────
  { name: 'Intercom', category: 'support', scripts: [/widget\.intercom\.io\/widget\//i, /js\.intercomcdn\.com\//i] },
  { name: 'Drift', category: 'support', scripts: [/js\.driftt?\.com\/include\//i] },
  { name: 'Zendesk', category: 'support', scripts: [/static\.zdassets\.com\/ekr\//i, /widget-snippet\.zendesk\.com\//i] },
  { name: 'Crisp', category: 'support', scripts: [/client\.crisp\.chat\//i] },
  { name: 'Tawk.to', category: 'support', scripts: [/embed\.tawk\.to\//i] },
  { name: 'Tidio', category: 'support', scripts: [/code\.tidio\.co\//i] },

  // ─── A/B testing ─────────────────────────────────────────────────────────
  { name: 'Optimizely', category: 'ab-testing', scripts: [/cdn\.optimizely\.com\//i] },
  { name: 'VWO', category: 'ab-testing', scripts: [/dev\.visualwebsiteoptimizer\.com\//i] },
  { name: 'Mutiny', category: 'ab-testing', scripts: [/client\.mutinycdn\.com\//i, /client\.mutinyhq\.com\//i] },
  { name: 'Intellimize', category: 'ab-testing', scripts: [/cdn\.intellimize\.co\//i] },

  // ─── Email/marketing tools ───────────────────────────────────────────────
  { name: 'Customer.io', category: 'email-marketing', scripts: [/assets\.customer\.io\/assets\//i, /track\.customer\.io\//i] },
  { name: 'Iterable', category: 'email-marketing', scripts: [/api\.iterable\.com\//i] },
  { name: 'Sendgrid', category: 'email-marketing', headers: { 'x-sg-id': /.+/i } },

  // ─── Reviews ─────────────────────────────────────────────────────────────
  { name: 'Trustpilot', category: 'reviews', scripts: [/widget\.trustpilot\.com\//i] },
  { name: 'Yotpo', category: 'reviews', scripts: [/staticw2\.yotpo\.com\//i] },
  { name: 'G2', category: 'reviews', scripts: [/widget\.g2\.com\//i] },

  // ─── Scheduling ──────────────────────────────────────────────────────────
  { name: 'Calendly', category: 'scheduling', scripts: [/assets\.calendly\.com\//i], html: [/calendly-inline-widget/i] },
  { name: 'Cal.com', category: 'scheduling', scripts: [/embed\.cal\.com\/embed/i, /app\.cal\.com\/embed/i] },
  { name: 'HubSpot Meetings', category: 'scheduling', scripts: [/static\.hsappstatic\.net\/MeetingsEmbed\//i] },

  // ─── Video ───────────────────────────────────────────────────────────────
  { name: 'Vimeo', category: 'video', scripts: [/player\.vimeo\.com\/api\/player\.js/i], html: [/player\.vimeo\.com\/video\//i] },
  { name: 'YouTube Embed', category: 'video', html: [/www\.youtube(-nocookie)?\.com\/embed\//i] },
  { name: 'Wistia', category: 'video', scripts: [/fast\.wistia\.net\/assets\/external\/E-v1\.js/i] },
  { name: 'Loom Embed', category: 'video', html: [/www\.loom\.com\/embed\//i] },

  // ─── Hosting / CDN / Edge ────────────────────────────────────────────────
  { name: 'Vercel', category: 'hosting', headers: { server: /^Vercel$/i, 'x-vercel-id': /.+/i, 'x-vercel-cache': /.+/i } },
  { name: 'Netlify', category: 'hosting', headers: { server: /^Netlify$/i, 'x-nf-request-id': /.+/i } },
  { name: 'Cloudflare', category: 'cdn', headers: { server: /^cloudflare$/i, 'cf-ray': /.+/i, 'cf-cache-status': /.+/i } },
  { name: 'AWS CloudFront', category: 'cdn', headers: { 'x-amz-cf-id': /.+/i, via: /CloudFront/i } },
  { name: 'Fastly', category: 'cdn', headers: { 'x-served-by': /^cache-/i, 'fastly-debug-path': /.+/i } },
  { name: 'jsDelivr', category: 'cdn', html: [/cdn\.jsdelivr\.net\//i] },
  { name: 'Amazon S3', category: 'hosting', headers: { server: /^AmazonS3$/i } },

  // ─── Fonts ───────────────────────────────────────────────────────────────
  { name: 'Google Fonts', category: 'fonts', html: [/fonts\.googleapis\.com\//i, /fonts\.gstatic\.com\//i] },
  { name: 'Adobe Fonts (Typekit)', category: 'fonts', html: [/use\.typekit\.net\//i] },
  { name: 'Hosted Fonts (self)', category: 'fonts', html: [/@font-face\b/i] },
];

function matchSignature(
  sig: TechSignature,
  html: string,
  scriptSrcs: string[],
  headers: Record<string, string>,
  metaTags: Record<string, string>,
): string | null {
  if (sig.scripts) {
    for (const re of sig.scripts) {
      for (const src of scriptSrcs) {
        if (re.test(src)) return `script src ${src.substring(0, 80)}`;
      }
    }
  }
  if (sig.html) {
    for (const re of sig.html) {
      if (re.test(html)) return `html pattern ${re.source.substring(0, 40)}`;
    }
  }
  if (sig.headers) {
    for (const [name, re] of Object.entries(sig.headers)) {
      const val = headers[name.toLowerCase()];
      if (val && re.test(val)) return `header ${name}: ${val.substring(0, 50)}`;
    }
  }
  if (sig.meta) {
    for (const [name, re] of Object.entries(sig.meta)) {
      const content = metaTags[name.toLowerCase()];
      if (content && re.test(content)) return `meta ${name}: ${content.substring(0, 50)}`;
    }
  }
  return null;
}

function extractScriptSrcs(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

function extractMetaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<meta\b[^>]*\bname=["']([^"']+)["'][^>]*\bcontent=["']([^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out[m[1].toLowerCase()] = m[2];
  return out;
}

export interface TechStackResult {
  detected: DetectedTech[];
  byCategory: Record<TechCategory, DetectedTech[]>;
  total: number;
}

export function detectTechStack(
  html: string,
  headers: Record<string, string> | undefined,
): TechStackResult {
  if (!html) {
    return { detected: [], byCategory: {} as Record<TechCategory, DetectedTech[]>, total: 0 };
  }
  const hdrs = headers ?? {};
  const scriptSrcs = extractScriptSrcs(html);
  const metaTags = extractMetaTags(html);

  const detected: DetectedTech[] = [];
  for (const sig of SIGNATURES) {
    const evidence = matchSignature(sig, html, scriptSrcs, hdrs, metaTags);
    if (evidence) {
      detected.push({ name: sig.name, category: sig.category, evidence });
    }
  }

  const byCategory: Record<TechCategory, DetectedTech[]> = {} as Record<TechCategory, DetectedTech[]>;
  for (const tech of detected) {
    if (!byCategory[tech.category]) byCategory[tech.category] = [];
    byCategory[tech.category].push(tech);
  }

  return { detected, byCategory, total: detected.length };
}

export const TECH_CATEGORY_LABELS: Record<TechCategory, string> = {
  analytics: 'Analytics',
  advertising: 'Advertising / pixels',
  'tag-manager': 'Tag managers',
  consent: 'Consent management',
  cms: 'CMS',
  framework: 'Framework',
  hosting: 'Hosting',
  cdn: 'CDN',
  ecommerce: 'E-commerce',
  'forms-crm': 'Forms / CRM',
  support: 'Customer support',
  'email-marketing': 'Email marketing',
  'ab-testing': 'A/B testing',
  reviews: 'Reviews',
  video: 'Video',
  scheduling: 'Scheduling',
  fonts: 'Fonts',
  misc: 'Other',
};
