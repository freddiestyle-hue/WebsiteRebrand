# Design brief · /audit HQ landing page (rivett.tech/audit)

**For:** Claude (web app · design mode · `/design-consultation` · `/design-html` · `/design-shotgun`).
**Author:** Fred Style (Rivett).
**Date:** 2026·05·26.
**Status:** v0.1. Sits alongside `audit-tool-design-brief.md` (the audit tool itself); this one covers the **public HQ landing page**.

---

## 0 · How to read this brief

This brief is **self-contained.** You will not see the conversation that produced it. Everything you need to design the page is here. Where a file or token is referenced, the canonical path is given.

**One design surface to produce:**

The HQ landing page at `rivett.tech/audit`. Public, indexed, the front door for the audit story.

The structural scaffolding is built (Astro page + 6 modular block components). Your job is the visual pass: type, color, spacing, hierarchy, motion, layout within each block. The composition is locked. The copy is placeholder; do not write copy, restyle what is there.

---

## 1 · What this is

`rivett.tech/audit` is the public homepage of the Rivett audit story. Three audiences hit it:

1. **Cold organic traffic** finding Rivett for the first time, usually after reading a blog post or a Nick Huber referral
2. **Prospects who got a personalised memo** at `/audit/v3/<slug>` or `/audit/p/<slug>` and clicked the wordmark to learn more about Rivett
3. **Evaluators** sent the link by an operator who is considering booking

Single conversion goal: **book a diagnostic call** at `/diagnostic`.

It is not:
- A SaaS dashboard
- A sales deck in HTML
- A long-form essay
- The audit tool itself (that lives at `/audit/v3` and is in a separate brief)

---

## 2 · Audience

**Primary persona — the operator.**
- Founder, CEO, Owner, or President of a 10-150 person B2B company
- Revenue range $1M-$50M
- Still personally involved in marketing/growth decisions, often because their last marketing hire underdelivered
- Has been pitched by enough agencies to be allergic to "best in class" / "drive growth" language
- Wants proof, not promises. Will respect specificity over polish.

**Secondary persona — the evaluator.**
- Marketing lead, RevOps lead, or operator's right hand
- Sent the link by the operator with "what do you think of this?"
- Looking for credibility signals fast: real numbers, specific findings, real names

Both personas read on mobile first ~60% of the time based on PostHog traffic on adjacent pages.

---

## 3 · Strategic context

Rivett is Fred Style. Operator marketing for operator-led B2B SMBs. The audit is Fred's wedge: a free 9-dimension read on a domain, delivered as a memo, used to start every relationship.

The audit story has surface area:
- The interactive scanner at `/audit/v3`
- 40+ personalised memos at `/audit/v3/<slug>` and `/audit/p/<slug>`
- The Beaphar case (longest-read memo so far, 31s engaged dwell) is the prototype of what the audit does in the wild
- This HQ page ties the whole story together

The site's tone is operator-direct, not agency. Fred writes in lowercase. He uses italics for half-thoughts. He uses no em dashes. He calls things by their real name.

---

## 4 · Existing visual identity (do not deviate)

### 4.1 Palette

Defined in `src/styles/tokens.css`:

- `--paper: #FFFFFF`
- `--paper-2: #F4F2ED` (off-white, paper warmth)
- `--paper-3: #EBE6DC` (deeper paper)
- `--sage: #E8F0D9` (background accent for blocks)
- `--ink: #0E1A2C` (primary text)
- `--ink-dim: #3A4658` (secondary text)
- `--ink-faint: #7A8597` (tertiary, kickers, meta)
- `--accent: #8FBF3F` (CTA green, lighter)
- `--accent-deep: #4A6E18` (CTA hover / dark surfaces)
- `--accent-bg: #F2F7E5` (accent-tinted backgrounds)
- `--line: rgba(14,26,44,0.14)` (hairlines)
- `--line-strong: rgba(14,26,44,0.28)` (heavier dividers)

Use the tokens. Do not introduce new colours unless explicitly necessary, and if you do, justify and add them to `tokens.css`.

### 4.2 Type

- `Inter Tight` (variable weight 400-800) — primary grotesk, all headings and body
- `Newsreader` (italic only) — used for **italicTail** accents inside headlines (the second half of a headline, voice change)
- `DM Mono` (400, 500) — kickers, section numbers (§ 01 etc.), meta labels, tags

Wordmark: lowercase `rivett·` with a small `--accent` dot. Already implemented in `Nav.astro` and `Base.astro`. Do not redesign.

### 4.3 Hairlines and rhythm

The Rivett aesthetic uses thin hairlines (`--line`) for separation, generous whitespace, and section numbers in mono caps (e.g. `§ 01 · The read`). See `drafts/audit-static-legacy.html` for taste reference (this was the hand-coded mockup of /audit that this build replaces).

---

## 5 · Voice rules (non-negotiable)

- **No em dashes.** Commas, periods, sentence breaks, or hyphens only.
- **No emoji.** Never.
- **Sentence-case headlines.** Not Title Case.
- **Italics on the tail** of headlines: the headline ends with a serif italic phrase that turns the statement on itself. Set via the `italicTail` prop. Example: `"Nine reads on your domain. *One verdict.*"`
- "Notes" not "Articles". "Memo" not "Report". "Diagnostic" is the call, not the audit.
- Author byline: Fred Style.

---

## 6 · Page structure (locked)

The page is composed of 6 modular blocks. Each block is a standalone Astro component you restyle in isolation. Do not collapse blocks, do not reorder, do not remove.

Order of appearance, top to bottom:

| # | Block | File | Role |
|---|---|---|---|
| 01 | Hero | `src/components/audit/HeroBlock.astro` | Above-the-fold pitch and CTA |
| 02 | Problem | `src/components/audit/ProblemBlock.astro` | Name the leak. 2x2 grid of failure modes |
| 03 | How | `src/components/audit/HowBlock.astro` | The 9 dimensions, 3-col grid |
| 04 | Proof | `src/components/audit/ProofBlock.astro` | 4 stat cards + example-memo link |
| 05 | CTA | `src/components/audit/CTABlock.astro` | Book a diagnostic, inverted block |
| 06 | FAQ | `src/components/audit/FAQBlock.astro` | 5 questions, first open by default |

All blocks extend `src/components/audit/Block.astro`, which provides the `<section class="block">` wrapper and viewport-enter analytics. Do not modify `Block.astro` semantics.

---

## 7 · Block-by-block intent

### 7.1 Hero
- **Goal:** in 3 seconds, communicate "this is the audit, it has substance, book the call."
- **Content:** kicker (`The Rivett audit`), headline + italicTail, dek (1-2 lines), primary CTA (`Book a diagnostic` → `/diagnostic`), secondary CTA (`See an example memo` → `/audit/v3`).
- **Layout:** dominant headline, generous breathing room. Above-the-fold completion required on 360px width and 1440px.
- **Don't:** illustrate. No hero image, no person photo, no product mockup. The voice is the visual.

### 7.2 Problem
- **Goal:** name 4 specific leaks the operator will recognise. Make them nod.
- **Content:** section number (§ 01), headline + italicTail, intro paragraph, 4 bullets each with heading + body.
- **Layout:** 2x2 grid on desktop, 2x2 collapse to single column on mobile.
- **Don't:** moralise. Each bullet should describe the mechanic, not the consequence. "Page over 4s LCP" not "you're losing customers."

### 7.3 How (Nine Dimensions)
- **Goal:** prove substance. Show that "audit" means a specific, structured 9-dimension read, not a vibe check.
- **Content:** section number (§ 02), headline + italicTail, intro paragraph, 9 dimension cards each with code (D · 01), title, one-line body.
- **Layout:** 3x3 grid on desktop, 2-col on tablet, single-column on mobile. Cards should feel scannable, not heavy.
- **Don't:** explain too much per card. The card is a label. The audit memo is where the depth lives.

### 7.4 Proof
- **Goal:** demonstrate this is real and people use it. Bridge to clicking into a memo.
- **Content:** section number (§ 03), headline + italicTail, intro paragraph, 4 stat cards (placeholder values), "See an interactive audit" link.
- **Layout:** 4 stats in a row on desktop, 2x2 on tablet, single-column on mobile.
- **Don't:** use stock testimonial cards. If you want a quote, build something native that feels like a Field Note callout, not a SaaS testimonial.

### 7.5 CTA
- **Goal:** the close. Convert anyone who got this far.
- **Content:** section number (§ 04), headline + italicTail, body paragraph, primary CTA (`Book a diagnostic`), secondary CTA (`Email instead`), signature line.
- **Layout:** consider high contrast against rest of page. An inverted block (dark on cream paper) creates a closing-moment feel. Take inspiration from the dark-CTA pattern at the bottom of `src/pages/audit/p/[slug].astro`.
- **Don't:** make it feel like a popup, a modal, or an offer.

### 7.6 FAQ
- **Goal:** answer the 5 objections operators have without making the page longer.
- **Content:** section number (§ 05), headline + italicTail, 5 questions each with `<details><summary>` accordion. First open by default.
- **Layout:** clean accordion, thin hairlines between items, no chevron icons heavier than the existing ones.
- **Don't:** force open all questions. Cognitive load is the enemy.

---

## 8 · What you can change

- Type sizes, weights, leading, tracking (within the existing 3-family system)
- Layout grids, column counts, card patterns
- Backgrounds (paper-2, paper-3, sage, accent-bg as section tones)
- Spacing scale (current Block padding is 4rem on top/bottom — feel free to redefine)
- Decorative elements: rules, dot marks, mono numerals, side-of-page meta
- Motion: subtle entry on scroll (200-400ms ease), hover states on CTAs and cards
- Reuse of patterns from `public/audit/memo.css` to create design cohesion with memo pages

---

## 9 · What you must NOT change

- The composition: 6 blocks, in this order, on this page
- The Block component's analytics attributes: `data-block`, `data-block-label`, `data-block-threshold`
- The CTA tracking: `data-cta` attributes and their values
- CTA destinations: `/diagnostic`, `/audit/v3`, `mailto:fred@rivett.tech`
- The `Base.astro` layout shell (Nav, PostHog snippet, fonts, schema)
- The headline pattern of (kicker) + (headline) + (italicTail) + (dek)
- The voice rules in §5
- The token names in `tokens.css` (you can add tokens; don't rename or remove existing)
- The copy. Fred owns the words. Style what is there.

---

## 10 · Functional requirements

- **Mobile-first.** Design for 360px first, scale up. 60% of audit-adjacent traffic is mobile.
- **Performance budget:** initial page weight under 200KB excluding fonts and the PostHog snippet. No tracking pixels beyond PostHog (already loaded by `Base.astro`).
- **Core Web Vitals on mid-range mobile:** LCP < 2.0s, CLS < 0.05, INP < 200ms.
- **WCAG AA contrast.** Use the existing token combinations; they already meet AA.
- **No new JS dependencies.** Astro server-rendered, vanilla CSS. No Tailwind, no React, no framework migration.
- **Indexable.** This is a public page (no `noindex`). Don't add `noindex,nofollow`. Already in the sitemap.

---

## 11 · Surrounding files Claude Design should read

In order:

1. `src/pages/audit/index.astro` — the page composition + placeholder copy you are styling around
2. `src/components/audit/Block.astro` — the wrapper. Read but do not modify its analytics semantics.
3. `src/components/audit/HeroBlock.astro` — and the 5 sibling blocks
4. `src/styles/tokens.css` — colour, type, spacing tokens
5. `src/styles/global.css` — global reset and base rules
6. `src/styles/components.css` — shared component patterns
7. `drafts/audit-static-legacy.html` — the hand-coded mockup of this page that the new build replaces. **Use this as your visual taste reference.** Match its aesthetic, surpass its structure.
8. `public/audit/memo.css` — the memo-page styling. Adjacent surface; design cohesion expected.
9. `src/pages/audit/p/[slug].astro` — for the dark-CTA pattern at the bottom

---

## 12 · Out of scope

- The memo pages at `/audit/v3` and `/audit/p/<slug>` — they have their own design language documented in `audit-tool-design-brief.md`
- The interactive scanner form on `/audit/v3` — separate brief
- The homepage at `/` — out of scope, do not modify
- Copywriting — Fred owns
- Information architecture changes — locked to the 6 blocks

---

## 13 · Success criteria

The page is successful when:

1. A cold operator visitor lands and within 5 seconds knows what Rivett does
2. The page feels indistinguishable from `drafts/audit-static-legacy.html` in taste, but more structured and conversion-focused
3. CTA visibility is high (primary CTA seen at least 3 times across the page without feeling repeated)
4. The page does not feel like a SaaS landing page, a Webflow template, or an agency site
5. Every section earns its slot. If a section feels generic, it has failed.
6. Mobile experience is as considered as desktop, not a compressed afterthought

---

## 14 · Open questions for Claude Design to surface

Before mocking, please flag:

- Whether the inverted CTA block needs reflected token additions (a `--ink-paper` pairing for text-on-dark)
- Whether the example-memo link in the Proof block should be a card preview or a text link
- Whether the FAQ accordion needs a "show all" affordance or remains pure click-to-open
- Whether section numbers (§ 01 etc.) should sit inline with the headline, in a left rail, or above
- Any block whose placeholder copy makes the visual design genuinely uncertain (flag and defer)

End of brief.
