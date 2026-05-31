# Design brief · /hq ground-up redesign — the operator cockpit (rivett.tech/hq)

**For:** Claude (web app · design mode · `/design-consultation` · `/design-html` · `/design-shotgun`).
**Author:** Fred Style (Rivett).
**Date:** 2026·05·31.
**Status:** v0.1. Supersedes the locked IA in `docs/hq-dashboard-design-brief.md` (2026·05·26) and reconciles `docs/action-center-design-brief.md` (2026·05·28). The visual identity, voice, and functional sections of those two briefs still hold. This brief changes the *structure*.

---

## 0 · How to read this brief

This brief is **self-contained.** You will not see the conversation that produced it. Everything you need to redesign the dashboard is here. Where a file or token is referenced, the canonical path is given.

It assumes you have read, or will read, two prior briefs whose *visual system and voice* you inherit unchanged:
- `docs/hq-dashboard-design-brief.md` — the analytics surface. Its 9 sections become the **Analytics mode** of the new structure.
- `docs/action-center-design-brief.md` — the act surface. Its approved card becomes the **locked card DNA** of the cockpit (see §8).

**What you are designing:** a ground-up restructure of `/hq` into a two-mode operator tool — a **Cockpit** (what to do now) and an **Analytics** report (what happened) — on one server-rendered Astro page, mobile-first, vanilla CSS, no framework.

---

## 1 · What this is, and why we are redoing it

`rivett.tech/hq` is Fred's private command surface for the Rivett outreach machine. One user, cookie-authed, 404 to everyone else.

It has drifted into clutter, and the drift has a clear history:

1. **May 26** — `/hq` was designed as a nine-section analytics dashboard. Pure observation: who read the memos, where from, on what device. The data was the hero.
2. **May 28** — `/action-center` was built as a *separate* page, because (quoting the action-center brief) "`/hq` has become too interesting to act on. Fred opens it, looks at the data, doesn't write outreach." It got the approved "Card stack" dossier design.
3. **Since then** — the warm action queue *and* a cold-outbound "send queue" were both bolted back into the top of `/hq` ("lead with the queues"). The send queue isn't even in the section nav. The warm queue now exists in two places.

The result: `/hq` mixes two different jobs in one scroll, the cold send queue is an orphan, `/action-center` is a half-detached sibling, and the mobile rendering of the send queue is broken. Nobody re-briefed the structure when the queues arrived. **This brief is that re-brief.**

The redesign is not a reskin. It is an information-architecture decision: separate **act** from **observe**, give each a clean home, and stop the warm queue living in two places.

It is **not**:
- A SaaS product. No signup, billing, or multi-tenant.
- A public page. 404 if unauthed. No nav back to the marketing site.
- An always-on wall display. It is for active work, not passive monitoring.
- A replacement for PostHog. Deep dives still happen in the PostHog console.

---

## 2 · The user (only one)

Fred Style. Operator, founder of Rivett. Non-technical: no code, but fluent in product, marketing, and data. He is the sole audience and knows what every metric means.

He opens `/hq` in **two distinct postures**, and today the page serves them badly because it blends them:

- **Act posture (the daily driver).** "Who do I message right now?" Morning, desk or phone. He wants a short, ranked worklist of prospects to send a cold DM to or follow up with, each with everything needed to act one tap away. He does NOT want to be distracted by charts here.
- **Observe posture (the report).** "What happened since the last batch?" Once or twice a day, usually desktop. Engagement, geography, blog resonance, date-range comparison. Reference, not a to-do list.

Split by device, roughly: **60% mobile, 40% desktop.** Mobile is mostly act-posture (scan the queue, send, mark done between calls). Desktop is both.

The core failure today: the act posture and the observe posture compete for the same vertical space, so the work is buried under things he only glances at. The redesign gives each posture its own mode.

---

## 3 · Strategic context

The audit is the wedge. Every prospect gets a personalised memo at `/audit/v3/<slug>` or `/audit/p/<slug>`, instrumented for session replay, scroll depth, and CTA clicks, identified per slug, flowing to PostHog. Airtable holds the prospect CRM state (wave, tier, outreach stage, the drafted DM).

The machine is a loop: **cold send → they read → engagement signal rises → warm follow-up → booked call.** The cockpit should make that loop legible in one place: the cold sends waiting to go out, and the warm reads that earned a follow-up, side by side. The analytics mode is where Fred goes to understand the loop, not run it.

This is the difference that matters: **the cockpit is for running the loop, the report is for understanding it.** Every design decision should be able to answer "does this help him run the loop, or understand it?" and live in the right mode accordingly.

---

## 4 · The core idea: two modes

The whole redesign rests on one move. `/hq` becomes **two modes on one page**, switched by a single control near the top (the same mental model as the existing Humans/All traffic pill):

- **`COCKPIT`** — the default. Act posture. A glanceable pulse strip + the work queue. This is what loads when Fred opens `/hq`.
- **`ANALYTICS`** — one switch away. Observe posture. The nine analytics sections from the May 26 brief, redesigned in the same language, off the daily path.

The switch is not a scroll and not a separate URL path you have to remember — it is a mode toggle on `/hq` itself (URL param is fine, e.g. `?view=analytics`, so a bookmark/refresh holds the mode). Cockpit is always the default landing.

Everything else in this brief is detail in service of that one move.

---

## 5 · Existing visual identity (use these tokens, do not invent)

Canonical source: `rivett-ds/tokens.css` (imported via `src/styles/tokens.css`). The current `hq.astro` inlines its own subset — the redesign should consume the real tokens, not re-inline a partial copy. (A spacing-scale omission in the inline copy is exactly what broke the send queue's mobile padding.)

### 5.1 Palette
- `--paper: #FFFFFF`, `--paper-2: #F4F2ED` (warm off-white), `--paper-3: #EBE6DC` (deeper)
- `--sage: #E8F0D9` (accent background), `--sage-2: #D5E3B7`
- `--ink: #0E1A2C`, `--ink-dim: #3A4658`, `--ink-faint: #7A8597`
- `--accent: #8FBF3F` (forest green), `--accent-deep: #4A6E18` (hover/active), `--accent-bg: #F2F7E5`
- `--line: rgba(14,26,44,0.14)`, `--line-strong: rgba(14,26,44,0.28)`

Lean on hairlines and tabular layout. No heavy fills, dark blocks, or SaaS gradients.

### 5.2 Type
- `Inter Tight` (400-800) — UI, body, numbers, headings
- `Newsreader` (italic only) — sparing voice accents: the "italicTail" on a headline, and the per-prospect "why" line
- `DM Mono` (300-500) — kickers, section numbers (`§ 01`), meta labels, tier badges, all tabular numerics

Scale (from `rivett-ds`): `--t-display` clamp(56-124px), `--t-h-xl` clamp(36-48), `--t-h-lg 30`, `--t-h-md 22`, `--t-h-sm 17`, `--t-body 16`, `--t-body-sm 13.5`, `--t-meta 11`, `--t-caption 10.5`. Line-heights `--lh-h 1.05` … `--lh-body 1.55`. Mono tracking `--track-mono 0.22em`.

### 5.3 Spacing, borders, motion
- Spacing scale `--sp-1`…`--sp-40` (4px base: sp-1 4, sp-2 8, sp-3 12, sp-4 16, sp-5 20, sp-6 24, sp-8 32, sp-10 40 …). **Use these. Whatever you ship must import them, not assume them.**
- Borders: `--bw-hair 1px`, `--bw-rule 2px` (focus, emphasis under-rules), `--bw-thick 3px` (left-rail accent).
- Motion: `--ease cubic-bezier(0.2,0.6,0.2,1)`; durations `--dur-1 120ms` (colour swaps), `--dur-2 200ms` (expanders, toggles), `--dur-3 320ms` (page-level, rare). Subtle. No bounce, no long fades.

### 5.4 Reference aesthetics
Bloomberg-terminal restraint, Stripe dashboard density without their palette, a trader's paper reader, Linear's filter chips on Rivett paper. **Avoid:** GA chrome, Mixpanel cards, Notion hero illustrations, anything 3D/glass/gradient/blur, card shadows, rounded-everywhere chrome, purple/blue.

---

## 6 · Voice rules (non-negotiable)

- **No em dashes.** Commas, periods, hyphens.
- **No emoji.** Never. (The current send queue uses a `→` glyph in a button; arrows as glyphs are fine, pictographic emoji are not.)
- **Sentence-case** headlines and labels. Not Title Case.
- **Italic tails** on section/mode headlines: a short `Newsreader` italic phrase ending the line. E.g. "The next batch. *Twelve ready to send.*"
- "Reads" not "Pageviews". "Sessions" not "Visits". "Memo" for the audit deliverable. "Diagnostic" is the call. "Send" for a cold first touch, "Follow up" for a warm next touch.
- `font-variant-numeric: tabular-nums` on every number in a table or metric.
- Lowercase wordmark `rivett` with a small `--accent` dot. Do not redesign it.

---

## 7 · Information architecture (the new lock)

The May 26 brief locked nine sections in one scroll. **That lock is lifted.** The new lock:

### COCKPIT (default mode)
1. **Pulse strip** — the four KPIs: memo views, unique visitors, engaged reads, CTA clicks. Glanceable, compact, the only "numbers" in the cockpit. Keep it to a single quiet strip, not four loud hero cards. It earns its place as ambient context above the work, not as the headline.
2. **The Queue** — the heart of the cockpit. One place to work prospects, in two lanes:
   - **Follow up** — warm. Prospects who engaged a memo and earned a next touch. (This is today's action queue / the `/action-center` job.)
   - **Send** — cold. This week's outreach wave, drafted and not yet contacted. (This is today's send queue / `OutreachQueue`.)

   How the two lanes are organised on screen is the one genuinely open design question — see §9.

### ANALYTICS (one switch away)
3. The nine analytics sections from `docs/hq-dashboard-design-brief.md` §6, in that order and behaviour, restyled to match the cockpit's language: recent reads, top prospects, CTA clicks, blog, countries, cities, device/browser, traffic sources, activity timeline. The date-range control lives here (it drives the analytics queries). Today these sit behind two `<details>` disclosures; in the redesign they live behind the Analytics mode instead.

Server-rendered. Every interaction (mode switch, range change, anchor jump, row expand) is a full reload against a warm cache or a native browser behaviour. No SPA, no client framework, no virtualised lists.

---

## 8 · The card (LOCKED — inherit, do not reinvent)

On 2026·05·28 Fred ran a design pass on `/action-center` and approved **Variant C, "Card stack"** over editorial-briefing and email-triage directions. That card is the locked DNA for **both** queue lanes. The approved HTML is at `~/.gstack/projects/freddiestyle-hue-WebsiteRebrand/designs/action-center-20260528/variant-C.html`.

The card, as approved:
- A **strip** (sage ground) with a left tag in mono caps and a right timestamp.
- A **hero row**: circular initial avatar (sage ground, accent-deep letter), name (~28px Inter Tight 600), and a meta line `title · company`.
- A **"why" line** in `Newsreader` italic — the one-sentence reason this row exists.
- A **detail row** in mono caps — the proof points (sessions, views, dwell, expanded dimensions; or for cold, tier/industry/wave).
- An **actions bar**: a quiet left affordance (`✓ messaged`) and a right cluster ending in one prominent primary button (`--accent-deep`).

The two lanes are the same card with different content and primary action:

| | **Follow up** (warm) | **Send** (cold) |
|---|---|---|
| Strip tag | the signal: "4 people read it", "returning + engaged", "clicked book-a-call" | tier + rank + wave: "A+ · #3 · wave 2" |
| Why line | the engagement story (serif italic) | optional: the angle / hook for this prospect |
| Detail row | sessions · views · peak dwell · expanded dimensions | company · industry · tier |
| Primary action | **Draft DM** (opens the existing draft modal, do not redesign it) | **Send** (mint shortlink in DM, copy DM, open LinkedIn, mark "Connection Sent") |
| Secondary | open memo ↗ · ✓ messaged | open audit ↗ |
| Preview | not required | the **full DM/message body must be readable** (see §11 mobile) |

The card is locked at the level of *anatomy and DNA*. You may refine spacing, the strip treatment, how the lane is signalled, and how it reflows on mobile. You may not return to a dense table or a different card paradigm.

---

## 9 · The one open design question: lane organisation

Everything above is decided. This is not. Produce and compare at least these three directions (desktop and 390px mobile for each). A recommendation is expected.

- **A — Switch.** Within the cockpit, a segmented control `Follow up (N) · Send (N)` flips between the two lanes. One lane on screen at a time, under a directive line ("4 to follow up, 12 to send today"). Most focused, least on screen, hides one lane's state behind a tab.
- **B — Stack.** Both lanes visible in one scroll as labelled sections — `§ Follow up` then `§ Send · wave 2` — each with its own count and one-line intent. Nothing hidden, zero clicks to see everything, longer page.
- **C — Blend.** One unified queue sorted by urgency, the lane shown as a tag on each card's strip. The system decides order, Fred works top down. Most "don't make me think", but mixes two different primary actions (draft vs send) in one list.

Author's lean: **A (Switch)** for focus, with the directive line carrying the at-a-glance counts so nothing important is truly hidden. Defend or overturn.

---

## 10 · The shell and navigation

- **Mode toggle.** A single, quiet two-option control (`Cockpit | Analytics`) near the top, same family as the Humans/All pill. Cockpit default. The active mode is unmistakable without shouting.
- **Desktop.** A persistent left rail is permitted and probably right. In Analytics mode it carries the nine section anchors with scroll-synced active state (as the May 26 brief envisaged). In Cockpit mode it is light — wordmark, mode, the two lanes, live indicator, date. Do not show nine analytics anchors while in Cockpit; that is the clutter we are removing.
- **Mobile.** The rail collapses to a top bar. The mode toggle stays visible and full-width-tappable. No left rail. The cockpit is a single column.
- **Trunk test.** Cover everything except the chrome. Fred should still know: this is HQ, which mode he is in, and how to switch. If not, the nav failed.

---

## 11 · Device contexts

Carry forward §7 of the May 26 brief, with these cockpit-specific points.

### Mobile (canonical 390px, range 360-430)
- Cockpit is the hero. Pulse strip compact (a 2x2 or a single scannable strip), then the queue.
- **The message preview must be fully readable on touch.** Today the send queue truncates the DM to one line and only expands on `:hover`, which never fires on a phone, so Fred cannot read what he is about to send. In the redesign the DM/message body is readable on the card without hover. This is a hard requirement, not a nicety.
- Primary action (`Send` / `Draft DM`) is a full-width or thumb-reachable button. Min tap target 44x44px. No hover-only affordances anywhere.
- Lane switch (direction A) or section headers (direction B) must be obviously tappable.

### Desktop (canonical 1280, max content ~1100-1200 centered)
- Cockpit can use the horizontal room: the card can be wider, the pulse strip a single row. Consider whether the two lanes can sit closer together (a two-column cockpit on wide screens is worth exploring in direction B).
- Hover affordances welcome (row hover, button states). Subtle entry transitions on mode switch, not on first paint.
- Analytics mode behaves as the May 26 brief specifies.

---

## 12 · Data shapes (what is real — design to these)

You are not inventing data. The queries already return these.

- **Pulse / `HeadlineMetrics`** (`src/utils/posthog/query.ts`): `memo_views`, `unique_visitors`, `engaged_reads`, `cta_clicks`, each with a previous-period value and a sparkline array.
- **Follow-up lane / action queue**: `getTopProspects` returns `TopProspect { prospect (slug), heat_score, last_view, sessions … }`, joined to `prospectInfo: Map<slug, ProspectInfo>` carrying name, title, company, `outreachStage`. A `isActionableProspect(p)` helper gates the heat tier. Rows past `Sent / Replied / Booked / Won / Lost / Disqualified` drop out. The draft-DM modal already exists and works — reuse it, do not redesign its interior.
- **Send lane / `OutreachQueueRow`** (`src/utils/hq/airtable.ts`, consumed in `src/components/hq/OutreachQueue.astro`): `recordId`, `slug`, `linkedinUrl`, `linkedinDm` (the full drafted DM body), `priority` (e.g. `"A+ #3"` — parse to tier letter + rank), `firstName`, `displayName`, `title`, `company`, `industry`, `auditUrl`. Driven by the current wave (`CURRENT_WAVE`, today "Wave 2 - This Week"). The Send action mints a per-recipient shortlink for any `rivett.tech/audit/v3/<slug>` URL in the DM, copies the DM, opens LinkedIn, then POSTs `/api/hq/mark-messaged` with stage "Connection Sent".

Edge cases to design for: empty lane (honest one-line italic, e.g. "no cold sends queued. the wave is clear." / "no warm reads today. send more outreach."), a very long DM body, a missing title or industry, a long company name, a prospect with no audit URL.

---

## 13 · Reconciling /hq and /action-center

The warm queue currently lives in both `/hq` and `/action-center`. The redesign must end the duplication. Author's intended direction, for the designer and eng to confirm:

- The **Cockpit's Follow-up lane absorbs the `/action-center` job.** `/action-center` either redirects to `/hq` (cockpit, follow-up lane) or is retired. One home for the act posture.
- The approved Card-stack design and the existing `ActionQueue.astro` machinery (heat badges, draft modal, messaged toggle, replay drill-down) are inherited by the Follow-up lane, not rebuilt.

If you believe `/action-center` should survive as a focused standalone instead, say so and why — but the default is consolidation into the cockpit.

---

## 14 · What you can change / must not change

**Can change:** all visual styling, the mode-toggle and lane-organisation design (§9, §10), the pulse-strip treatment, card spacing and lane signalling, table-to-card reflow in Analytics, motion, empty states, the date-range affordance (the old brief called the current one "horrific" — fix it in Analytics mode).

**Must not change:** the two-mode idea (§4); the locked card DNA (§8); the data the queries return (§12); server-rendered, no framework, no SPA; the cookie-auth model and the 404 for unauthed; token names in `rivett-ds`/`tokens.css` (add, never rename/remove); the `<details>`/`<summary>` semantic for expandable analytics rows; the draft-DM modal interior; the voice rules (§6); one URL serving both device contexts (no `/m/hq`).

---

## 15 · Functional requirements

- **Mobile-first.** Design 390px first, scale up. ~60% of use is mobile.
- **Instant.** Warm server-side cache (Upstash Redis) gives sub-200ms renders. **Do not design loading states, skeletons, or progress bars.** The page paints fully formed.
- **CSS budget** under ~80KB. No JS framework. No web fonts beyond the three families.
- **WCAG AA** contrast (existing token pairings already pass). Tap targets ≥44px. Tabular numerics on all figures.
- **No client-side data fetching.** Server renders everything. The only client JS is the send-queue interaction (clipboard + window.open + mark-messaged) and any IntersectionObserver for scroll-synced nav.
- Print and tablet-specific layouts are out of scope.

---

## 16 · Files to read first

In order:
1. `src/pages/hq.astro` — the orchestrator. How modes/sections compose today, the inline token subset, the auth gate.
2. `~/.gstack/projects/freddiestyle-hue-WebsiteRebrand/designs/action-center-20260528/variant-C.html` — the **approved card**. Start the card here.
3. `src/components/hq/OutreachQueue.astro` — the cold send lane (and the current mobile breakage).
4. `src/components/hq/ActionQueue.astro` — the warm lane machinery to inherit.
5. `src/components/hq/KpiCard.astro` + `MetricCard.astro` — pulse-strip metrics.
6. `src/components/hq/DateRangeNav.astro` — lives in Analytics mode; the old brief flagged it for redesign.
7. `src/components/hq/SectionHeader.astro` and the analytics components (`RecentReadsFeed`, `TopProspectsTable`, `CtaClicksFeed`, `TopBlogPostsTable`, `CountryTable`, `CityTable`, `DeviceTable`, `ReferrerTable`, `ActivityTimeline`).
8. `src/utils/hq/airtable.ts` and `src/utils/posthog/query.ts` — the data shapes (§12).
9. `rivett-ds/tokens.css` and `src/styles/tokens.css` — tokens. `rivett-ds/design.md` — the system notes.
10. `docs/hq-dashboard-design-brief.md` and `docs/action-center-design-brief.md` — the two briefs this one builds on.

---

## 17 · Out of scope

- The PostHog replay UI (opens in a new tab).
- The marketing site (`/`, `/blog/*`, `/audit`, `/audit/v3`, `/audit/p/*`, `/diagnostic`) — separate briefs.
- Auth UX and the 404 page.
- The draft-DM modal interior ("exactly as is" per Fred).
- The data itself — what the queries return is product, not design.
- Native mobile app, tablet layout, print.

---

## 18 · Open questions for the designer to surface

Before mocking, flag:
1. **Lane organisation (§9):** A / B / C or a hybrid? This is the central call.
2. **Pulse strip in the cockpit:** is it even right to show numbers above the work, or does it pull Fred back into observe-mode? Argue for keep / shrink / move-to-analytics.
3. **Mode toggle placement:** top bar centre, left rail, or a segmented header? On mobile especially.
4. **/action-center fate (§13):** consolidate into the cockpit (default) or keep standalone?
5. **Lane signalling:** how does a card say "I'm a cold send" vs "I'm a warm follow-up" without a heavy badge?
6. **Desktop two-column cockpit:** worth it on wide screens, or does single-column focus win on every width?
7. **Empty states:** one honest italic line per lane — propose the exact copy.
8. **Cross-mode continuity:** when Fred is in Analytics and spots a hot prospect, how does he get to the cockpit to act on it? A per-row "send/follow up" jump?

---

## 19 · Success criteria

The redesign succeeds when:
1. Fred opens `/hq` on his phone and within 3 seconds sees the work waiting — sends and follow-ups — not a wall of analytics.
2. Cold outbound no longer feels like an orphan. It is a lane of the cockpit, equal to follow-ups, with a readable message on mobile.
3. Switching to Analytics is one obvious action, and Analytics feels like a deliberate report, not a scroll he fell into.
4. The warm queue lives in exactly one place.
5. The cockpit and analytics modes read as one product — same card rhythm, type, hairlines.
6. It never looks like a SaaS template: no card shadows, no rounded-everywhere chrome, no purple/blue, no illustrations.
7. The work is the hero in Cockpit; the data is the hero in Analytics. Nothing competes. If a thing does not help Fred run the loop or understand it, it is cut.

End of brief.
