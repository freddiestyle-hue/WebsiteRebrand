# Design brief · /hq private analytics dashboard (rivett.tech/hq)

**For:** Claude (web app · design mode · `/design-consultation` · `/design-html` · `/design-shotgun`).
**Author:** Fred Style (Rivett).
**Date:** 2026·05·26.
**Status:** v0.1. Sits alongside `audit-tool-design-brief.md` (the audit tool) and `audit-hq-design-brief.md` (the public landing page). This brief covers **the private analytics dashboard** at `/hq`.

---

## 0 · How to read this brief

This brief is **self-contained.** You will not see the conversation that produced it. Everything you need to design the dashboard is here. Where a file or token is referenced, the canonical path is given.

**What you are designing:**

Two surfaces of the same page:
1. **The mobile web app experience.** Fred checks this from his phone while travelling, between calls, in line for coffee. Quick scan + tap-through.
2. **The desktop web app experience.** Fred sits with this open in a tab during outreach review. Dense data, exploration, multi-section comparison.

Same data, same URL, same functionality. Different layout, density, and interaction pattern per device. Server-rendered Astro with vanilla CSS. No frameworks.

---

## 1 · What this is

`rivett.tech/hq` is Fred's private analytics dashboard for the Rivett site. He logs in once (cookie persists 1 year), then this is where he reads what's happening across:

- Who is reading the personalised audit memos sent via cold outreach
- Per-session replay links so he can watch any prospect's actual session
- Which blog content lands with the audience
- Where in the world the traffic is coming from
- What devices and browsers visitors use
- How they found the site (currently 100% direct, but that will change)
- Daily pulse of pageviews + unique visitors

It is **not**:
- A SaaS product. There's no signup, no billing, no multi-tenant.
- A public-facing page. Returns 404 if not authenticated. Don't add navigation back to the marketing site.
- An always-on TV display. Designed for active exploration, not passive monitoring.
- A replacement for PostHog. The PostHog console exists for deep dives. This is the daily working surface.

Single user: Fred. He is the only audience, and he knows what every metric means.

---

## 2 · The user (only one)

Fred Style. Operator, founder of Rivett. Non-technical (no code, but understands product, marketing, data). He cares about:

- **Recent reads** — who looked at his audits in the last few hours / days. This is his retargeting hit list. He acts on it the same day.
- **Engagement signal** — dwell time, scroll depth, CTA clicks. Distinguishes "scanner opened the URL" from "real human read for 30 seconds and might book a call."
- **Geography** — which countries/cities his outreach is reaching. He sends batches by region (UK day, US day) and wants to verify the reach.
- **Blog resonance** — which posts are getting read. Informs his content calendar.
- **Date range comparisons** — "what changed since I sent the May 25 batch?" "How does this week look vs last week?"

How he uses it:
- **Mobile (60%)** — checks 3-5 times a day. Glance at recent reads, scan for hot signals (CTA clicks, long dwell). Tap into a session if something stands out.
- **Desktop (40%)** — once or twice a day during outreach review. Cross-reference top prospects with his Airtable CRM. Compare blog post performance over time. Watch session recordings in-line.

He is on his phone or on his laptop. There is no tablet experience to design for separately — tablet is a desktop with a smaller screen.

---

## 3 · Strategic context

Rivett's outreach machine is the audit. Every prospect gets a personalised memo at `/audit/v3/<slug>` or `/audit/p/<slug>`. These pages are instrumented (session recording, scroll tracking, CTA tracking, identify per slug). The data flows to PostHog.

This dashboard is Fred's command centre for that machine. The faster he can see what's happening, the faster he can act on warm prospects.

The current dashboard works (live at `/hq`) but it looks like a long form, not a product. Sections stack vertically. The date range bar feels bolted on. Mobile rendering is rough (tables don't fit). The whole thing reads as "good engineering, no design pass."

Your job is to make it feel like a product Fred wants to open.

---

## 4 · Existing visual identity (use these tokens, don't invent new ones)

### 4.1 Palette

Defined in `src/styles/tokens.css`:

- `--paper: #FFFFFF`
- `--paper-2: #F4F2ED` (off-white, paper warmth)
- `--paper-3: #EBE6DC` (deeper paper)
- `--sage: #E8F0D9` (background accent)
- `--ink: #0E1A2C` (primary text)
- `--ink-dim: #3A4658` (secondary text)
- `--ink-faint: #7A8597` (tertiary, kickers, meta)
- `--accent: #8FBF3F` (forest green, accents and highlights)
- `--accent-deep: #4A6E18` (darker green, hover and active states)
- `--accent-bg: #F2F7E5` (accent-tinted backgrounds)
- `--line: rgba(14,26,44,0.14)` (hairlines)
- `--line-strong: rgba(14,26,44,0.28)` (heavier dividers)

For dashboards specifically: lean on hairlines (`--line`) and tabular layouts. Avoid heavy fills, dark blocks, or "saas dashboard" gradients.

### 4.2 Type

- `Inter Tight` (variable weight 400-700) — UI labels, body, numbers
- `Newsreader` (italic only) — used very sparingly for "italicTail" voice accents on section headlines
- `DM Mono` (400, 500) — kickers, section numbers (§ 01 etc.), meta labels, all tabular numerics

### 4.3 Reference aesthetics

Think:
- Bloomberg Terminal restraint (dense data, tabular numerics, mono labels)
- Stripe.com/dashboard's information density without their colour palette
- A trader's daily reader on paper — disciplined, mono-leaning, no decoration
- Linear's filter chips applied to Rivett's paper aesthetic

**Avoid:**
- Google Analytics chrome (too corporate)
- Mixpanel cards (too saas-bro)
- Notion empty-state hero illustrations (wrong tone)
- Any 3D, glass, gradient, blur, or "modern dashboard" embellishment

---

## 5 · Voice rules (non-negotiable)

- **No em dashes.** Commas, periods, hyphens only.
- **No emoji.** Never.
- **Sentence-case** for headlines and labels. Not Title Case.
- **Italic tails** on section headlines: a brief italic phrase that ends the headline. E.g. "Recent reads. *Who looked at what, when.*"
- "Reads" not "Pageviews" when human-facing. "Sessions" not "Visits". "Memo" for the audit deliverable.
- All numeric columns use `font-variant-numeric: tabular-nums`.

---

## 6 · Information architecture (locked)

The page has **nine sections** in this order. Don't reorder, don't merge.

| # | Section | What it does | Where the design matters |
|---|---|---|---|
| 01 | Recent reads | Per-session feed of every real human read in the last N days, with engagement-coded left rail and replay link | Mobile: this is the hero. Make it scannable on the phone. |
| 02 | Top prospects | Ranked aggregate per-prospect with expandable per-session drilldown | Desktop: dense table. Mobile: card list. |
| 03 | CTA clicks | Feed of every tracked CTA click | Both: list. Critical event when it appears, design should celebrate it. |
| 04 | Blog content | Top blog posts by engagement | Standard data table. |
| 05 | Visitors by country | Country breakdown with % share bars | Standard table with visual progress bar. |
| 06 | Cities and regions | City-level with scanner/self/real tags | Standard table with row tags. |
| 07 | Device and browser | Mobile/Desktop/Tablet split cards + device/browser/OS table | Standard cards + table. |
| 08 | Traffic sources | Referrer breakdown | Standard table. |
| 09 | Activity over time | Daily pageviews + visitors SVG sparkline + total cards | The chart is the centrepiece of this section. Make it crisp. |

Above the sections:

- A **headline metrics row** (4 KPI cards) at the top: memo views, unique visitors, engaged reads, CTA clicks.
- A **date range control** that drives the whole page (preset pills + custom range).
- A **section anchor nav** that lets you jump between sections.

The page is server-rendered. Every interaction (range change, anchor jump) is either a full reload or native browser scroll. **No client-side framework. No SPA. No virtualised lists.**

---

## 7 · Device contexts

### 7.1 Mobile web app experience

**Viewport:** 360-430px width is the common range. Design for 375px as your canonical.

**Posture:** Fred is one-handed, on the move, reading screen-at-a-glance. He's either looking for hot signals (a recent read, a CTA click) or doing a quick wellness check.

**The 5-second job:** Open dashboard → see if anything important happened today → tap into the session if so.

**Specific mobile requirements:**

1. **Date range control needs to collapse.** A pill row that scrolls horizontally OR a compact dropdown trigger that opens a bottom sheet / modal with the presets and custom range. Phones do not have room for 6 pills + custom inputs + apply on one line.

2. **The anchor nav becomes a horizontal scrolling tab bar** or compresses into a "Jump to" dropdown. Currently it wraps and takes too much vertical space.

3. **Tables must reflow.** §02 top prospects table has 7 columns. On mobile, collapse into cards: prospect name + headline metric on the top line, secondary metrics below, expandable to show sessions. Same pattern for §04, §05, §06, §07, §08.

4. **The 4-card headline metrics grid** is 2x2 on mobile. Keep it that way. The cards should be roughly square and big enough to glance.

5. **The activity timeline chart** needs to remain readable on a narrow screen. Maybe show fewer days, or scroll horizontally, or simplify to a sparkline only.

6. **Tap targets minimum 44x44px.** Pills, links, expand chevrons all need to be tappable, not pointed.

7. **No hover-only affordances.** Every interaction has to work on touch.

8. **A floating "Jump to top" button** appears when scrolled past the first section. Useful given the page length.

### 7.2 Desktop web app experience

**Viewport:** 1024px to 1920px+. Design canonical at 1280px content width with a max content width of about 1200px centered.

**Posture:** Fred is at his desk with multiple tools open (Airtable CRM, LinkedIn, this dashboard). He's cross-referencing, scanning, sometimes pulling specific session replays.

**The 30-second job:** Open dashboard → set date range → scan top prospects → click into the prospect that engaged most → watch replay in PostHog → switch to LinkedIn to follow up.

**Specific desktop requirements:**

1. **A persistent sidebar nav** (left rail) is permitted and probably good. Show the 9 section labels with active-section highlighting that updates as you scroll. Replaces the current top anchor nav.

2. **The date range control sits at the top of the main content** alongside the headline kicker. Treat it like Stripe's dashboard date selector — quiet but always visible.

3. **Data tables can be wider.** Don't artificially constrain to a narrow column. Let tables breathe to about 900-1100px wide.

4. **Hover affordances are welcome.** Row hover highlight on tables. Tooltip on chart data points. Subtle entry transitions on data load (not on initial page load).

5. **The activity timeline** can be larger on desktop (say 240-300px tall) and show more axis context.

6. **Keyboard shortcuts** are a stretch goal — j/k for next/previous section, / to focus date range, etc. Not required but documented if implemented.

### 7.3 Shared across both

- The page is one URL. Same DOM, responsive CSS does the layout work. No separate mobile route.
- Server-rendered. No JS framework. Astro + vanilla CSS only.
- Cookie-authed. If not authed, render the existing 404 page (no design work there).

---

## 8 · Interaction patterns (locked behaviour, you style the surfaces)

### 8.1 Date range

The page state is **URL-driven**. Every change is a full page reload that hits a warm server-side cache.

- Six presets: Today, 7 days, 14 days, 30 days, 90 days, All time
- Custom `from`/`to` date range
- URL schema: `?range=7d` or `?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Active preset must be visually obvious without being loud
- Custom range should be a secondary affordance — most of the time Fred uses presets
- Loading: there is no loading state to design. The page reload completes in under a second on the cached path. Do not waste design effort on skeletons or progress bars.

### 8.2 Anchor nav

Mobile: horizontal scrollable tab bar OR a compact "Jump to ↓" disclosure. Desktop: left-rail sidebar with active section highlighted as you scroll.

The active section detection (sync with scroll position) is a stretch goal — can be done with vanilla IntersectionObserver if you want it. Not required.

### 8.3 Expandable rows (§02 top prospects)

Each prospect row is a `<details>` element. Summary shows aggregate. Body shows per-session list with replay links to PostHog.

- Click anywhere on the summary toggles
- Chevron rotates 180° when open
- Body has clear visual containment so it's obvious what belongs to which prospect

### 8.4 Replay links

`Watch replay →` links open PostHog session replay in a new tab. They're the single most actionable element on the page. Make them feel important without screaming.

### 8.5 Table rows

Hover state: subtle background tint (`--paper-2`). Active row (if implementing keyboard nav): more pronounced.

### 8.6 Empty states

Every section has an empty state. Don't show a heading + nothing. Show heading + a single italic line in `Newsreader` explaining what would populate it.

---

## 9 · What you can change

- All visual styling: type sizes, weights, spacing, colour application
- Layout grids and responsive breakpoints
- The date range nav's visual design (the current one is the part Fred specifically called "horrific")
- The anchor nav structure (top scroll bar vs left sidebar vs compact dropdown)
- Table row patterns and breakpoint behaviour
- Active state styling on pills, rows, anchors
- Motion: subtle transitions on hover, expand, range change
- Loading indication
- Empty states

---

## 10 · What you must NOT change

- The 9-section structure or order
- The data the queries return (you have no way to change it anyway)
- The URL schema (`?range=` / `?from=&to=`)
- The cookie auth model
- The decision to be server-rendered (no React, no client framework, no SPA)
- The token names in `src/styles/tokens.css` (you can add tokens, do not rename or remove existing)
- The fact that this is one URL serving both device contexts (no `/m/hq` or `/mobile/`)
- The voice rules in §5
- The semantic of `<details>` / `<summary>` for expandable rows
- The `data-cta` tracking attributes (none currently, but if you add new CTAs preserve the pattern)
- The 404 page for unauthed visitors (out of scope)

---

## 11 · Functional requirements

- **Mobile-first.** Design 375px first, scale up. About 60% of Fred's checks happen on mobile.
- **Instant.** The page IS instant. Server-side cache on the PostHog queries (Upstash Redis, ~60s TTL per range) gives sub-200ms page renders on a warm cache. First request in a TTL window is slower but still acceptable. **Do not design a loading state, skeleton screen, or progress bar.** The page paints fully formed. Cache is implementation, not design.
- **Page weight:** under 80KB of CSS. No JS framework. No web fonts beyond the existing three families.
- **WCAG AA contrast** for all text. Use the existing token combinations — they already meet AA.
- **Tap targets** minimum 44x44px on mobile.
- **Tabular numerics** everywhere numbers appear in tables.
- **No client-side data fetching.** Everything renders from the server.
- **Print is out of scope.** Don't waste time on print styles.

---

## 12 · Files Claude Design should read first

In order:

1. `src/pages/hq.astro` — the dashboard page. This is the orchestrator. Read it to understand the layout and how sections compose.
2. `src/components/hq/DateRangeNav.astro` — **the part Fred specifically called horrific. Start your redesign here.**
3. `src/components/hq/SectionHeader.astro` — section heading pattern (§ 01 etc.)
4. `src/components/hq/MetricCard.astro` — the 4 KPI cards at top
5. `src/components/hq/RecentReadsFeed.astro` — §01 hero section, engagement-coded left rail
6. `src/components/hq/TopProspectsTable.astro` — §02 expandable prospect rows
7. `src/components/hq/CtaClicksFeed.astro` — §03
8. `src/components/hq/TopBlogPostsTable.astro` — §04
9. `src/components/hq/CountryTable.astro` — §05 with progress bars
10. `src/components/hq/CityTable.astro` — §06 with row tags
11. `src/components/hq/DeviceTable.astro` — §07 split cards + table
12. `src/components/hq/ReferrerTable.astro` — §08
13. `src/components/hq/ActivityTimeline.astro` — §09 SVG sparkline
14. `src/utils/posthog/dateRange.ts` — the date range type and presets you'll be designing around
15. `src/utils/posthog/query.ts` — the data shape that flows into each component
16. `src/styles/tokens.css` — design tokens
17. `src/styles/global.css` — global reset

---

## 13 · Out of scope

- The PostHog session replay UI (that's PostHog's product, opens in a new tab)
- The marketing site (`/`, `/blog/*`, `/audit`, `/diagnostic`, `/audit/v3`, `/audit/p/*`) — separate briefs cover those
- Authentication UX — current cookie-set on first ?key= visit is fine. Don't design a login form.
- Mobile app (real native app, App Store, etc.) — not happening
- Tablet-specific layout
- Print styles
- The data itself — what queries return is product, not design

---

## 14 · Open questions for Claude Design to surface

Before mocking, flag:

1. **Anchor nav placement on desktop:** left rail sidebar vs top sticky bar vs both. Currently top sticky. The left rail probably wins for desktop but means a bigger restructure.
2. **Headline metrics treatment:** 4 cards is the current pattern. Are they too prominent? Should they be inline strip vs grid?
3. **Mobile table → card pattern:** which fields go on the headline vs in the expanded body? Same answer for all tables or per-table?
4. **Date range affordance on mobile:** dropdown that opens a bottom sheet vs always-visible pill row that scrolls horizontally. Both work, pick one and defend it.
5. **Visual density:** Fred wants a real product, not a flat page. How dense should desktop be? Are there places to add a second column (e.g. recent reads beside top prospects on desktop)?
6. **Loading indication:** GitHub-style top progress bar, full-page skeleton, or just the browser's native indicator? The reload is 2-4 seconds.
7. **Empty state voice:** italic single line is current. Want to propose anything richer?
8. **Section icons:** zero icons currently. Do any sections benefit from one (subtle, mono-stroke, paired with section number)?

---

## 15 · Success criteria

The dashboard is successful when:

1. Fred opens it on his phone and within 3 seconds knows whether anything important happened today
2. Fred opens it on desktop and immediately sees the recent reads + top prospects without having to scroll
3. The date range control feels like a single, clean affordance, not three components glued together
4. Every section looks like it belongs to the same product (consistent rhythm, type, table style)
5. Mobile tables feel native, not "squeezed desktop"
6. The page never looks like a saas template. Specifically: no card shadows, no rounded-everywhere chrome, no purple/blue, no cute illustrations.
7. The data is the hero. The chrome supports it. If you find yourself adding decoration, delete it.

End of brief.
