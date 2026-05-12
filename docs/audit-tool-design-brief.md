# Design brief · Rivett Visibility Engine (audit.rivett.tech)

**For:** Claude (web app / design mode / `$D` variants / `/design-consultation`).
**Author:** Fred Style (Rivett).
**Date:** 2026·05.
**Status:** v0.1, written after office-hours session 2026·05·12.

---

## 0 · How to read this brief

This brief is **self-contained.** Claude design does not see the conversation that produced it. Everything Claude needs to mock screens, propose variants, or critique a draft is here. If a token, voice rule, or component is referenced, the canonical source is named with a path.

**Two design surfaces to produce:**
1. **The paste screen** — where an operator enters their URL and submits.
2. **The result screen** — the audit memo Rivett returns.

Both surfaces ship under `audit.rivett.tech` as a subdomain of the existing Rivett Astro project. They must look like Rivett — same hand, same voice, same hairlines.

---

## 1 · Project context

### 1.1 What this is

A free, single-URL audit tool at `audit.rivett.tech`. Operator pastes a URL. The tool runs 15 checks (sitemap, robots, JSON-LD schema, llms.txt, AEO surfaces) and returns a diagnostic memo about how well AI engines (ChatGPT, Perplexity, Claude, Gemini) and Google understand the site's authority. Email-gated fix-kit download. Result page is publicly shareable.

### 1.2 What it is not

- Not a SaaS dashboard. No app shell, no sidebar, no settings.
- Not a scorecard with a single big number. Score exists but plays a supporting role.
- Not a subscription tool. One-shot audit. The deliverable is the memo.
- Not for marketers. For SMB operators (Boss Trailers, KO Storage, SMB Law — Nick Huber ecosystem). Non-technical buyers.

### 1.3 Who it's for

Primary audience: SMB operator (CEO / owner / president of a 10-150 person business). Reads memos. Does not read product docs. Evaluates competence by tone and specificity, not by feature count.

Secondary audience (incidental): builder / operator-builder overlap. Will look at the GitHub repo + see Fred's name. Trust signal compounds via brand, not via direct conversion.

### 1.4 What the operator should feel

Sitting across from a senior consultant who just read their site for fifteen minutes and now has something to say. The memo has the weight of having been considered, not generated. The grading is honest. The recommendations are ranked. The H1 stings without being mean.

---

## 2 · Design system to consume

The Rivett design system v1.0 is the source of truth. **Do not invent values.** Pull from these files:

- `rivett-ds/design.md` — the full rules (§1 stance, §2 tokens, §4 components, §7 voice).
- `rivett-ds/tokens.css` — every variable. Imports are CSS custom properties.
- `rivett-ds/templates/audit.html` — **the canonical audit memo design.** This is the reference Claude should match in spirit. Cover · TL;DR · 6 numbered sections · ranked recommendations · end-CTA.
- `rivett-ds/06-voice.html` and `docs/voice.md` — voice rules.
- `design-spec/Rivett Homepage.html`, `Rivett Blog.html`, `Rivett Blog Post.html` — reference for how an actual Rivett page looks.

### 2.1 Locked tokens (do not change)

- **Surfaces:** `--paper` `#FFFFFF`, `--paper-2` `#F4F2ED`, `--paper-3` `#EBE6DC`, `--sage` `#E8F0D9`.
- **Ink:** `--ink` `#0E1A2C`, `--ink-dim` `#3A4658`, `--ink-faint` `#7A8597`.
- **Accent — the only colour:** `--accent` `#8FBF3F` (the dot), `--accent-deep` `#4A6E18` (small text + AA compliance), `--accent-bg` `#F2F7E5`.
- **Signal (sparingly):** `--signal-warn` `#B8651F` (caution / warn rows), `--signal-halt` `#9A2B2B` (halt / decline / destructive).
- **No success colour.** Success is the accent. **No info colour.** Info is `--ink-dim`.

### 2.2 Type families

- `--grotesk` Inter Tight (400/500/600/700/800)
- `--serif` Newsreader (400/500 with italic variants)
- `--mono` DM Mono (300/400/500)
- **No fourth family. No decorative cuts.**

### 2.3 Geometry

- **Square corners by default.** Only `--r-sm` 2px (very small chrome) and `--r-pill` 999px (dot mark, pill stamps) allowed. **No 4px, no 6px, no 8px corners. Ever.**
- **Hairlines, not shadows.** `--bw-hair` 1px is the default border on every separator. No box-shadow on cards.
- **Spacing on a 4-px base.** `--sp-1` 4, `--sp-2` 8, `--sp-3` 12, `--sp-4` 16, `--sp-5` 20, `--sp-6` 24, `--sp-8` 32, `--sp-12` 48, `--sp-16` 64, `--sp-20` 80, `--sp-24` 96, `--sp-32` 128. No raw px values in components.

### 2.4 The wordmark

`rivett` set in Inter Tight 700, lowercase, tracked `-0.05em`, followed by an `--accent` dot (0.32em square, `--r-pill`, translated `+0.04em` Y to sit on baseline). The dot is the signature. One wordmark dot per page. The dot is never animated, stroked, or gradiented.

### 2.5 Audit memo palette deviation (allowed)

The canonical audit memo at `rivett-ds/templates/audit.html` uses a **warmer paper** (`#F6F2EA`) than the main Rivett site (`#FFFFFF` / `#F4F2ED`), plus auditor's-pen colours: `#A33A1F` iron-oxide red, `#3F7553` forest green for "good", `#8A6A1F` warn-amber. **This deviation is intentional and locked.** The audit deliverable is a paper memo, not a web page in the brand chrome.

The PASTE screen lives in the main site chrome (white paper, accent green). The RESULT screen switches to memo chrome (warm paper, auditor's pen). Both still consume the same tokens.

---

## 3 · Surface 1 · The paste screen

### 3.1 Purpose

One job: get the operator to enter a URL and submit. Nothing else competes.

### 3.2 Required content blocks (in order)

1. **Top nav.** Rivett wordmark left. Two links right: "Field Notes" and "Diagnostic". Mono, uppercase, `--track-mono`, hairline bottom border on the nav strip.
2. **Hero.** One section. Stamp on top ("VISIBILITY ENGINE · V0.1" in mono uppercase, accent-deep colour, accent dot prefix). H1 grotesk 800 + serif italic clause. Dek in serif italic 22px, ink-dim, max 780px wide. Around 64-80px padding top.
3. **The form.** Single URL input field, full-width within content max, hairline ink border, paper background, no radius. Submit button to the right (Primary button: solid ink, paper text, mono uppercase 11px, accent-deep hover background). Below the input: a single mono line tagging the audit ("15 CHECKS · 60-SECOND SCAN · OPEN SOURCE ENGINE").
4. **Three reassurances** under the form, optional. Numbered list in mono labels (01/02/03) with one short sentence each. E.g., "Free. No login. No subscription." "Score visible immediately. Fix kit gated by email." "Open source engine. The audit code is the audit code you ran." No emoji.
5. **End-CTA** on dark ink. Headline grotesk 700, 36px. Body opacity 0.85. Primary CTA is `btn--inverse` (paper background, ink text, accent hover). Optional. Use only if the rest of the page is too short.

### 3.3 What's banned on this screen

- Stock illustrations. AI-generated hero images. Stock photos of laptops.
- Trust-badge logos ("As seen in...") unless they exist.
- Modal pop-ups, newsletter intercepts, exit-intent banners.
- Background gradients of any kind.
- Counts ("847 audits run this week") unless they're real.

### 3.4 Tone of the H1

The H1 should mirror the canonical memo's tone. Two clauses, serif italic carries the second clause. The pattern is "Statement of fact, *uncomfortable implication*." Examples (pick one or write a better one):

- "Does AI know *your business exists?*"
- "Your site is in Google. *Your site is not in ChatGPT.*"
- "An audit memo, not a score. *Twelve minutes to run.*"

Lead recommendation: **"Does AI know *your business exists?*"** — operator-direct, no jargon, the italic carries the cut.

---

## 4 · Surface 2 · The result memo

### 4.1 Purpose

Deliver a diagnostic memo that reads like a senior consultant wrote it. The structure is fixed, but the prose slots are deterministically populated from check results. Each check failure becomes a sentence, not a row.

### 4.2 Reference

**Match `rivett-ds/templates/audit.html` in spirit.** That mockup is a hand-written demo memo; the engine produces the same shape but populated by code. Do not depart from it without naming why.

### 4.3 Required structure (top to bottom)

1. **Memo mast.** Tiny mono nav row at top: `RIVETT · VISIBILITY ENGINE` left, `MEMO · YYYY·MM·DD · vXXXX` right. Accent dot indicator.
2. **Crumb.** Mono `BACK ↑ AUDIT INDEX · SHARE LINK`.
3. **Cover.** Kicker stamp ("AUDIT MEMO · NEW URL"). Then H1 display-size: "Statement of fact about the site, *uncomfortable second clause about what it means*." Then sub-grid (1.5fr / 1fr): lede paragraph on the left (~21px serif-italic flecked, max 680px), meta column on the right (mono labels: URL audited, date, audit ID, verdict — paired with grotesk values).
4. **TL;DR block.** `--paper-2` background, 1px ink border, 120/1fr grid. Stamp ("TL;DR" mono uppercase) + 2-3 sentence body (grotesk 500, 18px, line-height 1.55). Italic carries the second clause.
5. **Verdict grid.** 4-column inset, hairline ink borders. Each cell: mono key + grotesk grade (A/B/C/D/F or 0-100 score) + one-line caveat. Categories: `Crawlability`, `Structured Data`, `AEO Surfaces`, `Send-Readiness`. Grades are colour-coded via `--good` `--warn` `--bad`.
6. **Six numbered sections** (or fewer; the engine can suppress sections that are all-green). Each section: `01 · Section Name` mono kicker with accent dot, then H2 (grotesk 700, 32-52px clamp, italic clause), then dek (serif italic 19px, ink-dim, max 720px), then body paragraphs (grotesk 400, 17px, ink, max 720px).
   - **01 · Crawlability.** "Search engines can find the site. *Whether AI engines can read it cleanly is the question.*"
   - **02 · Structured data.** "Organization is present. *Article and FAQPage are missing on the very pages that needed them.*"
   - **03 · AEO surfaces.** "There is no llms.txt. *AI agents hitting your domain bounce off a 404.*"
   - **04 · Send-readiness.** "If you sent a list to this site today, *here is what they would and would not find.*"
   - **05 · Spec drift.** "The blog markup says one thing. *The footer says another.*"
   - **06 · Ranked recommendations.** "If you fix three things this week. *Fix these three.*"
7. **Adjacent observations** (optional, sage-tinted block). "We also noticed" — 2-3 single-sentence findings outside the AEO scope (form too long, no trust signals visible, etc.). Pull-quote treatment: top + bottom hairlines, body in serif 19px.
8. **CTA row.** Email-gated "Download fix kit" primary button + "Share result" ghost button + the shareable URL in mono.
9. **End-CTA.** Dark ink surface. "Want us to fix all of it? *Two weeks, $3,500.*" Inverse button to /diagnostic.

### 4.4 Findings, the rule

Findings are **paragraphs in operator voice**, not table rows.

Wrong (do not do):
```
× FAQPage schema missing       -4 pts
```

Right (canonical voice):
```
Your blog has a real FAQ section at the bottom of every post.
ChatGPT cannot tell. The page emits the words but not the
structured data that says "these are questions and these are
answers." Add FAQPage schema and the same content becomes
extractable. The fix is fifteen lines.
```

The check produces the structured outcome (which fields fired, which failed). The memo template produces the prose. Two separate concerns.

### 4.5 Voice rules (locked, from rivett-ds/design.md §7)

**Do:**
- One idea per sentence.
- Specific numbers.
- Period not em-dash.
- Italic carries the second clause, in `--serif` `--ink-dim`.
- Question marks only in the FAQ component, never in headlines (the canonical audit headline H1 violates this — that is allowed for the cover only).
- Sign off with `— FS, audit.rivett.tech · 2026·MM·DD` at the bottom of the memo.

**Don't:**
- Emoji.
- Em-dashes.
- "Leverage," "unlock," "empower," "10x," "journey," "solution," "synergy," "seamless," "frictionless," "best-in-class."
- Future tense in pricing.
- Marketer's voice in any finding.

**Swap:** utilize → use · solution → tool · deliver → ship · journey → funnel.

---

## 5 · Banned patterns (whole-product)

- No spinners. If a step takes >2 seconds, show a memo footnote ("READING THE CURVE · 03 SEC"). Not a spinner.
- No "Powered by Rivett" badge. The wordmark in the mast does that.
- No social-proof carousels. No testimonial cards. The result page IS the proof.
- No "Click here to see a sample audit" CTA. Run the audit on `rivett.tech` itself as the sample.
- No `<button>` set in title case. CTAs are mono uppercase, full stop.
- No coloured backgrounds except `--paper-2`, `--sage`, and `--ink` (the dark end-CTA). No purple, no blue gradients.

---

## 6 · Deliverables Claude should produce

If running variants (`$D variants` or Claude.ai design mode), produce **three explorations** of the result memo, each holding the canonical structure but varying:

- **Variant A: Memo-faithful.** Match `rivett-ds/templates/audit.html` exactly in spirit. Warm paper, auditor's-pen reds.
- **Variant B: Brighter memo.** Use the main Rivett site palette (`--paper`, `--accent-deep` for findings). Slightly more legible at first glance, slightly less "diagnostic-document" weight.
- **Variant C: Single-page scroll.** Same content, but flatten the section spacing for a tighter read on mobile. The 96-px section padding shrinks to 56px; numbered sections stack closer.

For the paste screen, **one variant is enough.** It is a single hero + form.

Deliver each as a self-contained HTML file (inline CSS, no external deps) so it can be screenshotted with `$B screenshot` and reviewed in the design board.

---

## 7 · How to verify a draft is on-brand

Run the **30-second checklist** before showing anything to Fred:

- [ ] All colours from §2.1. No off-palette hex codes anywhere.
- [ ] Inter Tight + Newsreader + DM Mono. No other families.
- [ ] Zero rounded corners except the wordmark dot.
- [ ] At least one italic clause in the H1.
- [ ] Period replaces em-dash everywhere.
- [ ] No emoji, no "leverage," no "unlock."
- [ ] The audit memo signs off `— FS, audit.rivett.tech · 2026·MM·DD`.
- [ ] The wordmark dot is `--accent`, not `--accent-deep`.
- [ ] No box-shadow on any element.
- [ ] No spinner.

If any item fails, fix before sending.

---

## 8 · Open questions for Fred

These are decisions Claude should NOT make alone. Surface them to Fred at the end of the variant deck.

1. **Memo signature.** Currently proposed: `— FS, audit.rivett.tech · 2026·MM·DD`. Should it be `— Fred Style, Rivett` or stay as initials in the memo style?
2. **Score scale.** A/B/C/D/F letter grades feel academic. 0-100 numeric feels SaaS. Suggest: **letter grades.** They match the memo voice ("This site grades a C on AEO surfaces"). Confirm.
3. **Shareable URL anonymisation.** If the audit ran on `bossfueltrailers.com`, the result URL is `audit.rivett.tech/r/x9k2-a7m4` — public, but anyone with the URL sees the domain audited. Should the public version mask the domain (e.g., "an SMB trailer dealer with 47 URLs in the sitemap")? Confirm before launch.
4. **Audit identity.** Should the memo carry "by Fred Style at Rivett" prominently in the mast, or stay neutral with just the Rivett wordmark? Lean: **prominent.** Fred's name is the credibility asset.

---

## 9 · References (paths in the repo)

- `rivett-ds/design.md` — full design system rules v1.0
- `rivett-ds/tokens.css` — every CSS custom property
- `rivett-ds/templates/audit.html` — canonical audit memo design ← **start here**
- `rivett-ds/templates/home.html`, `mri.html`, `post.html` — adjacent reference templates
- `rivett-ds/01-foundations.html` through `07-icons.html` — visual breakdown of the system
- `design-spec/Rivett Homepage.html`, `Rivett Blog.html`, `Rivett Blog Post.html` — site-level reference
- `docs/voice.md` — voice rules as plain markdown
- `src/styles/tokens.css` — the site's token bridge (consumes rivett-ds/tokens.css)

---

*— Brief maintained by Fred Style. Last edited 2026·05·12. The system is the moat. If a design contradicts this brief, the brief wins. The variant is wrong.*
