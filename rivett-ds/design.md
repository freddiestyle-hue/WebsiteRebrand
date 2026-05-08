# Rivett · Design System

**Version 1.0 · Issued 2026·MM · Canonical**

> A working manual, not a moodboard. If it isn't written here, it isn't part of the system. If the live site contradicts this document, the system wins — the page is wrong.

---

## 0 · How this document is organised

This is the source of truth for the rivett brand. Every page in the design system website renders directly from these rules; this `.md` is the rules in plain text, for review, diffing, and code agents.

```
rivett-ds/
├── Design System.html          ← visual hub
├── tokens.css                  ← single source for variables
├── 01-foundations.html         ← color · type · spacing · motion · grid
├── 02-identity.html            ← marks · wordmark · favicon · stamps
├── 03-components.html          ← buttons · forms · cards · nav · tables · modals · FAQ
├── 04-patterns.html            ← editorial blocks · hero · section heads
├── 05-templates.html           ← home · blog · post · MRI · diagnostic · 404
├── 06-voice.html               ← rules · lexicon · microcopy · format
├── 07-icons.html               ← 24-icon library · anatomy · expansion
└── design.md                   ← this file
```

The system is **token-driven only.** No raw pixel values, no raw hex codes in component CSS. Everything routes through `tokens.css`. If a component needs a value the tokens don't expose, the component is wrong — or the token is missing and must be added with a reviewer.

---

## 1 · Brand stance

A senior operator, writing late at night. Not a marketer. Not a coach. The work is to ship the right thing, instrumented, on the right cadence — and to know within a fortnight whether it is bending the curve.

The system enforces that stance through three commitments:

1. **Restraint over abundance.** One green. Three type families. Twenty-four icons. The palette is small on purpose. If the design needs another colour, the design is doing too much.
2. **Editorial over UI.** The page reads like a memo, not a SaaS dashboard. Hairlines, mono labels, italic serif for the second clause.
3. **The period replaces the em-dash.** Two short sentences beat one long one. Every time.

---

## 2 · Tokens

### 2.1 Surface

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#FFFFFF` | default page background |
| `--paper-2` | `#F4F2ED` | demo wells, raised cards, tldr |
| `--paper-3` | `#EBE6DC` | code chips, table heads |
| `--paper-4` | `#DDD7C9` | deepest paper · code blocks |
| `--sage` | `#E8F0D9` | tinted accent surface · numbox |
| `--sage-2` | `#D5E3B7` | sage hover/active |

### 2.2 Ink

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#0E1A2C` | primary type · dark surface bg |
| `--ink-2` | `#1B2940` | dark surface raised |
| `--ink-dim` | `#3A4658` | secondary type · italic serif on light |
| `--ink-faint` | `#7A8597` | meta strip · captions |
| `--ink-soft` | `#B6BCC6` | disabled · dividers on dark |

### 2.3 On-ink (inverse)

`--on-ink` `#FFFFFF` · `--on-ink-dim` `rgba(255,255,255,0.78)` · `--on-ink-italic` `rgba(255,255,255,0.62)` · `--on-ink-faint` `rgba(255,255,255,0.55)` · `--on-ink-line` `rgba(255,255,255,0.18)` · `--on-ink-line-2` `rgba(255,255,255,0.32)`

### 2.4 Lines

`--line` `rgba(14,26,44,0.14)` · `--line-strong` `rgba(14,26,44,0.28)` · `--line-soft` `rgba(14,26,44,0.06)`

### 2.5 Accent — the only colour

| Token | Hex | Use |
|---|---|---|
| `--accent` | `#8FBF3F` | the dot · hover fills · focus ring on dark |
| `--accent-deep` | `#4A6E18` | AA on paper · small text · focus ring on light |
| `--accent-bg` | `#F2F7E5` | sub-sage tint for callout backgrounds |

### 2.6 Signal — sparingly

| Token | Hex | Use |
|---|---|---|
| `--signal-warn` | `#B8651F` | MRI risk bars (amber row) only |
| `--signal-halt` | `#9A2B2B` | halt / decline icon · destructive only |

There is **no success colour.** Success is the accent. There is **no info colour.** Info is `--ink-dim`.

### 2.7 Type families

`--grotesk` Inter Tight (400, 500, 600, 700, 800) · `--serif` Newsreader (400, 500, 400 italic, 500 italic) · `--mono` DM Mono (300, 400, 500). No fourth family. No decorative cuts.

### 2.8 Tracking

`--track-mono` 0.22em · `--track-mono-tight` 0.16em · `--track-tighter` -0.03em · `--track-display` -0.055em · `--track-h` -0.04em · `--track-h-md` -0.03em · `--track-h-sm` -0.02em.

### 2.9 Type scale

| Token | Size | Use |
|---|---|---|
| `--t-display` | clamp(56, 8vw, 124) | hero only |
| `--t-h-xxl` | clamp(48, 6vw, 72) | section opener |
| `--t-h-xl` | clamp(36, 4.4vw, 48) | section h2 |
| `--t-h-lg` | 30 | h2 small · numbox v |
| `--t-h-md` | 22 | h3 |
| `--t-h-sm` | 17 | h4 · UI heads |
| `--t-body-xl` | 19 | feature body · pull-out |
| `--t-body` | 16 | default body |
| `--t-body-md` | 15 | card lede · supporting copy |
| `--t-body-sm` | 13.5 | tables · dense lists |
| `--t-meta` | 11 | mono labels · stamps |
| `--t-caption` | 10.5 | demo captions · footer |

Line heights: `--lh-display` 0.92 · `--lh-h` 1.05 · `--lh-h-prose` 1.18 · `--lh-body` 1.55 · `--lh-prose` 1.65 · `--lh-tight` 1.25.

### 2.10 Spacing — 4-px base

`--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 · `--sp-6` 24 · `--sp-7` 28 · `--sp-8` 32 · `--sp-10` 40 · `--sp-12` 48 · `--sp-14` 56 · `--sp-16` 64 · `--sp-20` 80 · `--sp-24` 96 · `--sp-32` 128 · `--sp-40` 160.

No raw pixel values. Everything routes through a token.

### 2.11 Radii

Default is **zero**. Rivett is square. The only allowed radii are `--r-sm` 2px (very small chrome only) and `--r-pill` 999px (the dot mark, pill stamps). No 4px, no 6px, no 8px corners. Ever.

### 2.12 Borders & hairlines

`--bw-hair` 1px (default border on every separator, every cell, every form field). `--bw-strong` 2px (focus ring, blockquote left rule).

### 2.13 Motion

| Token | Value | Use |
|---|---|---|
| `--ease` | `cubic-bezier(0.2, 0.6, 0.2, 1)` | the only easing curve |
| `--dur-1` | 120ms | colour swap · hover |
| `--dur-2` | 200ms | transform · expand · modal open |
| `--dur-3` | 320ms | reserved · page transition |

Reduced-motion is honoured everywhere — every transition wraps in `@media (prefers-reduced-motion: no-preference)`.

### 2.14 Grid

`--page-max` 1240px · `--page-pad` 56px (24px on viewports ≤780px). 12-column grid below the page max, with 24-px gutters. Section spec rows are `240px 1fr` desktop, single-column at ≤980px.

### 2.15 Focus

Two-pixel outline in `--accent-deep` on light surfaces, `--accent` on dark. Always offset 2px. Always rendered on `:focus-visible`, never `:focus`. Never removed. Never replaced with a shadow.

---

## 3 · Identity

### 3.1 Wordmark

`rivett` set in Inter Tight 700, lowercase, tracked -0.05em, followed by an accent dot. The dot is `0.32em` square, `--r-pill`, `--accent`, translated `+0.04em` on Y to sit on the baseline. The dot is the signature.

**Locked behaviours:**
- The wordmark is always lowercase. Never `Rivett`. Never `RIVETT`.
- The dot is always `--accent` (never `--accent-deep`).
- The dot always trails the wordmark, never leads.
- The dot is always a perfect circle. Never a bullet character, en-dot, or middot.
- One wordmark dot per page. The 8-px stamp dot is the only allowed echo.
- The dot is never animated, stroked, or gradiented.

### 3.2 Favicon · rivet B1

A 80×80 ink plate carrying the rivet glyph (a stylised lowercase `r` with the bowl closed) in white at 6-px stroke, square caps, mitre joins. Accent dot at `cx=62 cy=60 r=6`.

Used as favicon, app icon, and any context where the wordmark must render below 14px.

### 3.3 Stamps

The mono label, in three sizes. Always uppercase, always `--track-mono`, always preceded by an 8-px `--accent` dot. Two words after the dot is the maximum. Three is too many.

Variants: default (`--accent-deep` on paper), neutral (`--ink-faint`), on-dark (`--on-ink-faint` text, accent dot).

### 3.4 Clear space

Wordmark clear space is `0.5×` the cap height, on all four sides. Inside that band, no other element. The favicon clear space is `0.25×` its plate.

---

## 4 · Components

### 4.1 Buttons

Three variants. Never four.

- **Primary** — solid `--ink`, `--on-ink` text, `--accent-deep` hover background. Used for the single most important action on the page.
- **Secondary** — outline, `--ink` text on transparent, fills to `--ink` / `--on-ink` on hover.
- **Inverse** — for use on `--ink` surface only. Background `--paper`, fills to `--accent` on hover.

Sizes: default (11×18), large (18×26). Both are mono-cased uppercase, 11px, `--track-mono`, with an optional trailing arrow `→`.

The third button is a text-only crumb (no border, no background, accent-deep on hover). If a layout asks for a fourth button, the layout is doing too much.

### 4.2 Forms

- Inputs are full-width, paper background, `--bw-hair` ink border, no radius, no shadow.
- Labels are mono uppercase, 11px, `--track-mono`, `--ink-faint`, sat above the field with 8-px gap.
- Error state: `--signal-halt` border + helper text. Never red text on its own.
- Success: no green border. The form simply submits and a stamp confirms.
- Field required marker is the word `REQUIRED` in mono, `--signal-halt`, never an asterisk.

### 4.3 Cards

Cards are `--bw-hair` borders on paper. No box-shadow. No radius. The structure is: stamp · headline · 2-line body · meta.

When two cards sit beside each other, the divider is the right border of the left card — the cards share an edge.

### 4.4 Nav

The nav is `display: flex`, justify-between, with `--bw-hair` solid `--line` bottom border and `--sp-7 0 --sp-8` padding. Wordmark left, mono meta right. Mobile collapses to a 2-row strip; the wordmark never moves.

### 4.5 Tables

- Hairlines only. No zebra striping.
- Header row is `--paper-2` background, mono labels, `--track-mono`.
- Body rows are paper, body-sm copy, top-aligned.
- Numbers right-align. Text left-align. No centred columns.

### 4.6 Modals

Modals are full-bleed overlays at `rgba(14,26,44,0.78)` with a paper card centred. Card has `--bw-hair` ink border (not soft line), `--sp-12` padding. Open transitions on `--dur-2`. There is one close affordance — a mono `[ESC] Close` chip top-right.

### 4.7 FAQ

The FAQ is one of the few places where a question mark is allowed in a headline. Each question is a `details/summary` pair; the marker is a custom `+` that rotates to `−` on `--dur-2` open.

### 4.8 Numbox

Sage background, 3-px `--accent-deep` left border, two- or four-cell grid. Each cell is mono key + display value. Use for engagement parameters, MRI scores, pricing breakdowns.

### 4.9 TLDR

`--paper-2` background, `--bw-hair` ink border, two-column (90px stamp / 1fr body). Body is grotesk 500, 17px, line-height 1.6.

### 4.10 Pull quote

Top + bottom `--bw-hair` ink rules. Newsreader italic 32px, `--track-h-sm`, `--lh-tight`. Citation below in mono.

### 4.11 End-CTA

The only mandatory dark surface on a page. `--ink` background, `--sp-12` padding, two-column (1.4fr headline / 1fr right). Headline is grotesk 700, 36px. CTA is `btn--inverse`. Always closes the page.

---

## 5 · Patterns

### 5.1 Section spec

Every long-form section is a 240/1fr grid: a sticky mono label (with section number) on the left, body on the right. `--sp-20 0` padding top and bottom. `--bw-hair` `--line-strong` divider between sections.

### 5.2 Hero

One per page. `--sp-20 0 --sp-16` padding. Stamp · h1 · dek. Display type is grotesk 800, italic clause in serif 400. Dek is serif italic 22–30px, `--ink-dim`, max 780px.

### 5.3 Editorial flow

Long-form pages follow this skeleton:

1. Hero
2. Migration / banner (optional, only if there is news)
3. TOC (numbered)
4. Sections (each: stamp · h2 · lede · body · numbox/pull where appropriate)
5. End-CTA

Anything outside this kit is a one-off and a risk.

### 5.4 Density

Page density is "memo" — heavier than a marketing site, lighter than a docs site. Roughly 60-character body line length. Aggressive use of vertical rhythm via the spacing scale; never bespoke margins.

---

## 6 · Templates

| Template | Purpose | Anchor |
|---|---|---|
| Home | Practice surface · what TR does on a Tuesday | `templates/home.html` |
| Field Notes index | Editorial archive | `templates/blog-index.html` |
| Field Note | Long-form essay | `templates/blog-post.html` |
| Revenue MRI | The 12-vital diagnostic interactive | `templates/mri.html` |
| Diagnostic booking | Two-week engagement intake | `templates/diagnostic.html` |
| 404 | "The page isn't here." | `templates/404.html` |

Every template is built from the patterns in §5 plus components in §4. There are no template-bespoke styles.

---

## 7 · Voice

### 7.1 Rules

**Do** — one idea per sentence · specific numbers · concrete verbs · period not em-dash · italic for the second clause · en-dash for ranges only · question marks only in the FAQ · sign off with initials and date.

**Don't** — emoji · exclamation marks (except inside a quote) · em-dashes · `leverage` `unlock` `empower` `10x` `journey` `solution` · question marks in headlines · whole-sentence italic · "we" (singular practice) · future tense in pricing.

### 7.2 The italic rule

Newsreader italic carries the **second clause** of a thought, never the first. Pair with a roman first clause. Always `--ink-dim` on light, `--on-ink-italic` on dark. Never `--ink`. Never bold + italic.

### 7.3 Lexicon

- **Use generously:** diagnostic · fortnight · cadence · instrumented · halt · decline · read-out · memo · vital · signal · operator · field note.
- **Kill on sight:** leverage · unlock · empower · 10x · synergy · journey · solution · game-changer · at scale · seamless · frictionless · thought leader · best-in-class.
- **Swap:** utilize → use · solution → tool · deliver → ship · journey → funnel · growth hack → experiment · north star → number that matters.

### 7.4 Format

- Currency: `£4k` · `£12k / mo` · `£18,000` (board packs only).
- Dates: `2025·09·14` in metadata · `2025·09` in prose.
- Spans: `02 wks` · `04–06 wks` · `14 days`. Numerals lead.
- Numerals: leading zero on versions, modules, vitals — `v1.0`, `M · 01`, `V · 09`.
- Quotes: curly in prose `“ ”`, straight in mono `" "`.

### 7.5 Microcopy

| Context | String |
|---|---|
| Primary CTA | `Book diagnostic →` |
| Secondary CTA | `Read field notes` |
| MRI CTA | `Book the MRI →` |
| Form required | `FIELD REQUIRED` |
| Form success | `Saved · we'll reply inside 48 hours.` |
| 404 head | `The page isn't here.` |
| Loading | `One moment. Reading the curve.` |
| Sign-off | `— TR, Cape Town. 2026·MM` |
| Footer | `© rivett · 2026 · v1.0 · Cape Town & remote` |

---

## 8 · Iconography

### 8.1 Anatomy

24-grid · 1.6 stroke · square caps · mitre joins · fill `none` · 2-unit keyline padding. The accent dot, when used, is 1.4–1.6 radius, on intersection or endpoint, never floating. One dot per icon. Maximum.

### 8.2 Library — 24 marks

- **Core (06):** diagnostic · pipeline · signal · cadence · stack · operator
- **Functional (06):** approval · decline · halt · external · arrow · confirm
- **Editorial (06):** memo · outreach · field-note · archive · type · contents
- **Metric (06):** numbers · share · curve · cohort · vital · flag

### 8.3 Sizes

12 · 16 · 24 · 36 · 48. No others. Stroke does not scale; redraw at each step. Below 12, simplify. Above 48, use a graphic.

### 8.4 Treatment

Default ink stroke on paper. Sub on `--paper-2`. Tinted on `--sage`. Inverse white on `--ink`. The dot stays accent across every treatment except status — confirm uses accent, decline uses `--signal-halt`, halt uses `--signal-warn`.

### 8.5 In use — and only in use

Module heads · automate list · MRI rubric · status meta in tables · inline arrow at the end of a CTA. Nowhere else. Not in the hero. Not in body prose. Not in audience cards. Not as decoration.

### 8.6 Expansion

Adding a 25th icon replaces an existing member of its family. The headcount stays at 24. Reviewer is TR. Commit as `icons: add ic-NN · NAME · replaces ic-NN · NAME`.

---

## 9 · Revenue MRI

The MRI is a 12-vital diagnostic. Each vital scores **green / amber / red / insufficient**. The output is a one-page memo with the diagnosis, the next 90 days, and what to halt.

**Rubric tokens:**
- Green: `--accent` bar · `--accent-deep` stamp text.
- Amber: `--signal-warn` bar · `--signal-warn` stamp text.
- Red: `--signal-halt` bar · `--signal-halt` stamp text.
- Insufficient: `--ink-soft` bar · `--ink-faint` stamp text. *("A red is a finding. An insufficiency is a question that has not been asked.")*

**Output document:** numbered cover · TLDR · the twelve vitals (in order) · the 90-day plan · the halt list · sign-off.

The MRI **never** uses success/warning/error from a UI library. It uses the signal tokens above and nothing else.

---

## 10 · Accessibility

- Body copy ≥ 16px. Body-sm at 13.5px is a hard floor — never lower.
- Colour pairs are tested at AA against `--paper`. `--accent-deep` passes 4.5:1 on `--paper` for 16px+.
- Focus is mandatory. `:focus-visible` only. Two-pixel outline, 2px offset.
- Hit area ≥ 44×44 on touch.
- Reduced-motion is honoured everywhere.
- Icons have `role="img"` and `aria-label`, or `aria-hidden="true"` when decorative.
- Forms label-input pairing is explicit. No placeholder-as-label.

---

## 11 · Engineering contract

- `tokens.css` is the only source for variables. Component CSS imports tokens; component CSS exposes nothing of its own.
- No CSS-in-JS for tokens. Tokens are CSS custom properties so they can be overridden per surface (e.g. dark sections rebind `--ink` → `--on-ink`).
- Icons ship as inline SVG components and as a single sprite sheet at `/assets/icons.svg`.
- Fonts ship via Google Fonts (`Inter Tight`, `DM Mono`, `Newsreader`). Self-host before launch.
- Every change to tokens, components, or icons is a commit with a reviewer (TR). The commit message format is `area: change · reason`.

---

## 12 · Changelog

### v1.0 — 2026·MM (this document)
- Established as canonical. Supersedes v0.2 style guide.
- Token set finalised: surface, ink, on-ink, accent, signal, type, spacing, motion, focus.
- Component library at 11 patterns.
- Icon set at 24, in 4 families (core, functional, editorial, metric).
- Voice rules formalised including lexicon, swap list, microcopy strings.
- Templates listed; bespoke per-template CSS removed.

### v0.2 — 2025·11
- Accent migrated `#6FB582 → #8FBF3F`. Accent-deep migrated `#3F7553 → #4A6E18`.
- Favicon switched from abstract peak to rivet B1.
- 12-icon set introduced.

### v0.1 — 2025·08
- First style guide. Tokens were embedded; no separate stylesheet.

---

## 13 · How to use this system

1. Read §1 (stance) and §7 (voice) before opening any other section. The stance is what makes the system feel like one hand.
2. Pick the template (§6) for what you're building.
3. Compose with components (§4) and patterns (§5). Resist the urge to invent.
4. If you need a token that doesn't exist, talk to TR before adding it.
5. The system is enforced by review, not by tooling. The tooling helps; the review decides.

---

*— TR · Cape Town. Maintained at* `rivett-ds/design.md`.
