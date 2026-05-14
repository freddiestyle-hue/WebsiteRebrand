# Rivett · Design System

**Version 1.0 · Canonical · Last loaded 2026·05**

> A working manual, not a moodboard. If it isn't written here, it isn't part of the system. If the live site contradicts this document, the system wins — the page is wrong.

---

## 0 · What this is

The packaged Rivett design system. It contains the canonical token set, the type and colour roles, the 24-icon library, the wordmark and B1 mark, the voice rules, the full original spec pages (foundations → templates), and a UI kit recreating Rivett's marketing surface.

Designed to be used two ways:

1. **As a project resource** — agents browsing this folder pick up tokens, fonts, voice rules and components without ever inventing new values.
2. **As an installable skill** — drop the folder into `~/.claude/skills/` (or equivalent) and `SKILL.md` tells an agent how to brief itself on Rivett before designing anything.

## 0.1 · About Rivett

Rivett is a one-person growth practice (Tom Rivett · TR), operating from Cape Town and remote. It sells three modules: a two-week **Diagnostic** (£4k), a four-to-six week **Build** of stack + instrumentation (£18k), and a twelve-week minimum **Run** with fortnightly read-outs (£12k / mo). The product is a senior operator's attention. The deliverable is a memo with specific numbers.

The brand stance — established in [`design.md`](./design.md) §1 — is *"a senior operator, writing late at night. Not a marketer. Not a coach."* The system enforces this through three commitments: **restraint over abundance**, **editorial over UI**, and **the period replaces the em-dash**.

## 0.2 · Source materials

The following inputs were packaged into this system. None of them are required for downstream use — everything is consolidated below — but they are preserved under `spec/originals/` for diff and reference.

| Source | What it contained | Where it landed |
|---|---|---|
| `rivett-ds/design.md` | The canonical written system (token set, components, voice, MRI, accessibility, engineering contract). | [`design.md`](./design.md) |
| `rivett-ds/tokens.css` | v1.0 CSS custom properties + base resets + page chrome. | [`tokens.css`](./tokens.css) |
| `rivett-ds/Design System.html` + `01-…07-` | The hub + seven section pages of the live design system website. | [`spec/00-hub.html`](./spec/00-hub.html) → [`spec/07-icons.html`](./spec/07-icons.html) |
| `rivett-ds/templates/home.html`, `post.html`, `mri.html` | Working template pages built from the system. | [`spec/templates/`](./spec/templates/) |
| `docs/voice.md` | Voice & mark rules — the short field guide. | [`voice.md`](./voice.md) |
| `design-spec/Rivett Homepage.html`, `Rivett Blog.html`, `Rivett Blog Post.html` | Earlier hi-fi homepage / blog / post comps. | [`spec/originals/`](./spec/originals/) |
| `Rivett Audit.html` | Pre-system audit of the v0.2 site (what the system was reacting against). | [`spec/originals/Rivett Audit.html`](./spec/originals/Rivett%20Audit.html) |
| `Rivett Style Guide v0.2.html` | The previous (superseded) style guide. | [`spec/originals/Rivett Style Guide v0.2.html`](./spec/originals/Rivett%20Style%20Guide%20v0.2.html) |
| `src/styles/tokens.css` | v0.2 token set from the production codebase. | Folded into the v1.0 `tokens.css`; not separately preserved. |
| `src/pages/api/qualify.ts` | A single API route. Not design-relevant. | Not copied. |

---

## 1 · Content fundamentals

Rivett reads like a memo, never marketing copy. The voice is the brand. Below is the operating set — see [`voice.md`](./voice.md) and [`design.md`](./design.md) §7 for the full rules.

### 1.1 Stance

A senior operator, writing late at night. Confident, dry, specific. Not a coach. Not a marketer. *"The work is to ship the right thing, instrumented, on the right cadence — and to know within a fortnight whether it is bending the curve."*

### 1.2 Sentence shape

- One idea per sentence. Two short sentences beat one long one.
- **The period replaces the em-dash.** No em-dashes (`—`) ever. The closest acceptable mark is the en-dash (`–`) in numeric ranges only: `40–60 min`.
- Specific numbers replace adjectives. `£12k`, `30 markets`, `14 days`, `02 wks`. Never round to "millions" when you have the number.
- Concrete verbs: `run`, `ship`, `instrument`, `decline`, `halt`. Never `leverage`, `unlock`, `empower`.

### 1.3 The italic clause

Newsreader italic carries the **second clause** of a thought, never the first. The italic is the turn, not the statement.

> Growth infrastructure *for operators.*
> Three more *in the same key.*
> 40–60 *min.*

Rules: pair with a roman first clause. Always `--ink-dim` on light, `--on-ink-italic` on dark. Never `--ink`. Never bold + italic. Never a whole sentence in italic.

### 1.4 Casing

- Wordmark and most heads are **lowercase** (`rivett`). Never `Rivett`, never `RIVETT`.
- Body copy is sentence case.
- Stamps (mono labels) are **UPPERCASE** with `letter-spacing: 0.22em` and the 8-px accent dot.
- Module codes use leading-zero numerals: `M · 01`, `V · 09`, `v1.0`, `02 wks`.

### 1.5 Pronouns

Singular practice. The author uses `I` ("what I actually do on a Tuesday"). Never `we`. Never the editorial "we" used by solo operators pretending to be a team.

### 1.6 No emoji. No exclamation. No question marks (except FAQ)

- Emoji: never. Not in copy, not in CTAs, not in headers.
- Exclamation marks: never, except inside a literal quote.
- Question marks: never in headlines unless the section is genuinely a question (FAQ pattern). Inside the FAQ, use them generously.

### 1.7 Lexicon

| Use generously | Kill on sight | Swap |
|---|---|---|
| diagnostic · fortnight · cadence · instrumented · halt · decline · read-out · memo · vital · signal · operator · field note | leverage · unlock · empower · 10x · synergy · journey · solution · seamless · frictionless · best-in-class · north star | utilize → use · solution → tool · deliver → ship · journey → funnel · growth hack → experiment |

### 1.8 Numbers + dates

- Currency: `£4k`, `£12k / mo`, `£18,000` (board packs only).
- Dates: `2025·09·14` in metadata, `2025·09` in prose. Middle dot, not slashes.
- Spans: `02 wks`, `04–06 wks`, `14 days`. Numerals lead.
- En-dash for ranges only. Never hyphen. `40–60`, never `40-60`.
- No thousands separator below 10,000. `$10M`, not `$10,000,000`.

### 1.9 Microcopy library

| Context | String |
|---|---|
| Primary CTA | `Book diagnostic →` |
| Secondary CTA | `Read field notes` |
| MRI CTA | `Book the MRI →` |
| Back-out crumb | `← Field Notes` |
| Form required | `FIELD REQUIRED` |
| Form success | `Saved · we'll reply inside 48 hours.` |
| 404 head | `The page isn't here.` |
| Loading | `One moment. Reading the curve.` |
| Sign-off | `— TR, Cape Town. 2026·MM` |
| Footer | `© rivett · 2026 · v1.0 · Cape Town & remote` |

---

## 2 · Visual foundations

### 2.1 Palette

Paper, ink, **one green**. No second hue, no third hue, no decorative tints. Backgrounds step through four warm off-whites (`paper` → `paper-4`) plus one tinted accent surface (`sage`). Type runs through five ink steps. The accent (`#8FBF3F`) is the only colour and it is reserved for the wordmark dot, hover fills, and the focus ring on dark. Its deep variant (`#4A6E18`) is AA-safe for small text on paper.

Signal colours exist (`--signal-warn` amber-rust, `--signal-halt` deep red) but are reserved for the MRI rubric and destructive flows respectively. There is **no success colour** (success is the accent). There is **no info colour** (info is `--ink-dim`).

See [`tokens.css`](./tokens.css) for the full token table or the [Palette](./preview/colors-surface.html) cards.

### 2.2 Type

Three families, three jobs. No fourth. No decorative cuts.

- **Inter Tight** (400 / 500 / 600 / 700 / 800) — body, headlines, UI, mono is *not* this. The grotesk is the page's voice.
- **Newsreader** (400 / 500, plus 400 italic / 500 italic) — italic-only in practice. Carries the second clause. Always `--ink-dim`.
- **DM Mono** (300 / 400 / 500) — stamps, labels, module codes, tables, code chips. Always uppercased with `0.22em` tracking when used as a label.

Type scale runs from `--t-display` (`clamp(56, 8vw, 124)`) down to `--t-caption` (10.5px). Body floors at 16px. Body-sm at 13.5px is a hard floor; never lower.

Tracking is aggressive on display sizes (`-0.055em`) and on mono labels (`+0.22em`). The negative tracking is what makes Inter Tight read as a display face rather than a UI face.

**Note on font hosting.** Fonts ship via Google Fonts (`@import` at the top of `tokens.css`). The spec calls for self-hosting before launch. No font files are bundled in this folder — substitute by removing the `@import` and adding `@font-face` rules in `colors_and_type.css` if you need to self-host.

### 2.3 Geometry

**Rivett is square.**

- Default radius is **zero**. The only allowed radii are `--r-sm` 2px (tiny chrome only — checkbox tick area, tag) and `--r-pill` 999px (the dot mark, pill stamps). No 4px, no 6px, no 8px corners. Ever.
- Hairlines are 1px (`--bw-hair`). Stroke caps are square, joins are mitre. Icons obey the same rule.
- The dot is the only allowed curve in the system. Everything else is orthogonal.

### 2.4 Spacing

4-px base. The scale is `--sp-1` (4px) → `--sp-40` (160px) in steps that match the type rhythm. No raw pixel values in component CSS — everything routes through a token.

Layout grid is 12-column inside a 1240-px max with 24-px gutters. Section spec rows use `240px 1fr` (sticky mono label / body), collapsing to single column at ≤980px.

### 2.5 Backgrounds & imagery

No backgrounds. No full-bleed photography. No hand-drawn illustrations. No repeating patterns. No textures. **No gradients.** The page is paper and ink — that is the texture.

The only allowed background variation is between the four `--paper-*` tints, the `--sage` tinted callout, and a full ink surface (`--ink`) for the end-CTA and footer.

Imagery, when needed (the homepage has none), is treated as a neutral data plate, not as decoration. There is no warm/cool/grain mood applied. If a photo must appear, it sits inside a hairline border with no shadow.

### 2.6 Borders, shadows, elevation

- **Borders are the design language.** Cards share an edge — the divider between two adjacent cards is the right border of the left card, not a gap. Tables are hairlines, no zebra striping.
- **Shadows are almost off.** `--shadow-0` is the default. `--shadow-1` is a 1-px line for card press states. `--shadow-2` (`0 8px 24px -10px rgba(14,26,44,0.18)`) is the only elevation allowed, and it is reserved for the modal.
- No `box-shadow` on cards, no shadow on buttons, no inset shadows.

### 2.7 Motion

| Token | Value | Use |
|---|---|---|
| `--ease` | `cubic-bezier(0.2, 0.6, 0.2, 1)` | The only easing curve. |
| `--dur-1` | 120ms | Colour swap. Hover. |
| `--dur-2` | 200ms | Transform. Accordion expand. Modal open. |
| `--dur-3` | 320ms | Reserved. Page transition. |
| `--dur-4` | 500ms | MRI bar fill, reserved. |

No bounces, no overshoot, no spring physics. No fade-and-slide on every scroll. Reduced-motion is honoured everywhere via `@media (prefers-reduced-motion: reduce)`.

### 2.8 Hover & press states

- **Hover on light:** background shifts to `--paper-2`, or border darkens from `--line` to `--ink`. Never opacity. Never scale.
- **Hover on dark:** primary buttons swap background to `--accent-deep`; inverse buttons swap to `--accent`.
- **Hover on links:** colour to `--accent-deep`. Never underline-on-hover, never grow.
- **Press:** the accordion `+` rotates 45° to `×` on open (`--dur-2`). Buttons do not scale on press. No "shrink + spring back" sequences anywhere.

### 2.9 Focus

`:focus-visible` only. Two-pixel solid outline in `--accent-deep` on light, `--accent` on dark. Always offset 2px. Never replaced by a shadow. Never removed.

### 2.10 Cards

A card is `--bw-hair` border on `--paper`, no shadow, no radius. The internal structure is **stamp · headline · body · meta**, where headline uses the italic clause and meta is a mono label row at the bottom. When two cards sit adjacent, the divider is the shared edge — there is no gap between them.

### 2.11 Transparency & blur

There is no blur in the system. The only allowed transparency is in the on-ink ramp (`--on-ink-dim`, `--on-ink-italic`, `--on-ink-faint`) and the hairline ramp (`--line`, `--line-strong`, `--line-soft`). No frosted overlays, no glass surfaces, no semi-transparent panels.

### 2.12 Layout rules (fixed elements)

- The nav is **not** sticky. It scrolls with the page.
- The mono-label rail on `.spec` sections **is** sticky inside its grid row (`position: sticky; top: var(--sp-8);`).
- The dark closer (`.end-cta`) is mandatory and is always the last element on long-form pages.
- The footer is on a dark plate.

### 2.13 Section anatomy

Long-form pages follow this skeleton (see [`design.md`](./design.md) §5):

```
Hero → Migration banner (optional) → Numbered TOC →
Numbered sections (each: stamp · h2 · lede · body · numbox or pull) →
End-CTA (dark)
```

Anything outside this kit is a one-off and a risk.

---

## 3 · Iconography

### 3.1 Approach

Rivett ships **exactly twenty-four icons**, drawn on a 24-grid with a 1.6 stroke, square caps, and mitre joins. Fill is `none` everywhere except the optional accent dot — and there is at most one accent dot per icon, on intersection or endpoint, never floating.

The set is deliberately small. Rather than a pictogram for every noun, it splits into four families of six, each tied to a specific surface:

- **Core (06):** diagnostic · pipeline · signal · cadence · stack · operator
- **Functional (06):** approval · decline · halt · external · arrow · confirm
- **Editorial (06):** memo · outreach · field-note · archive · type · contents
- **Metric (06):** numbers · share · curve · cohort · vital · flag

A 25th icon must **replace** an existing member of its family. The headcount stays at 24. The reviewer is TR.

### 3.2 Where they live

Icons appear in only five contexts:

1. Module heads on the homepage (28-px stroke).
2. The automate list ("What I actually do on a Tuesday") at 24-px.
3. The MRI rubric (status meta).
4. Inline 16-px status badges inside tables.
5. As the trailing `→` arrow at the end of a CTA.

They **do not** appear in the hero, in body prose, in audience cards, in margins, or as decoration. If a section wants an icon as ornament, the section is wrong.

### 3.3 Sizes

Five steps: **12 · 16 · 24 · 36 · 48 px.** Stroke does **not** scale — each step is redrawn so the icon survives the size. At 12px the inner detail and the dot may drop. Above 48px the icon stops being an icon and becomes a graphic; use a different element.

### 3.4 Colour treatment

Four treatments, picked by surface. The dot stays `--accent` across every treatment except status icons (confirm = accent, decline = `--signal-halt`, halt = `--signal-warn`).

| Treatment | Stroke | Surface |
|---|---|---|
| Default | `--ink` | `--paper` |
| Sub | `--ink` | `--paper-2` |
| Tinted | `--ink` | `--sage` |
| Inverse | `--on-ink` (white) | `--ink` |

### 3.5 Assets in this folder

- [`assets/icons.svg`](./assets/icons.svg) — single sprite with `<symbol>` ids `ic-NN-name` (e.g. `#ic-01-diagnostic`). Reference via `<svg><use href="assets/icons.svg#ic-01-diagnostic"/></svg>`.
- [`assets/icons/`](./assets/icons/) — 24 individual SVG files, each with `stroke="currentColor"` so colour inherits.
- Spec page with anatomy, sizes, treatments, misuse: [`spec/07-icons.html`](./spec/07-icons.html).

### 3.6 Emoji & unicode

**Emoji are not used. Ever.** Not in copy, not in headers, not in CTAs, not as bullets. The 8-px green dot is the system's only ornament — it is rendered as a `border-radius: 999px` CSS element, never as the bullet character `•`.

Unicode arrows (`→`, `←`) are allowed inside CTAs and crumb links. The en-dash (`–`) is allowed inside numeric ranges. The em-dash (`—`) is forbidden, full stop.

---

## 4 · Wordmark & marks

### 4.1 Wordmark

`rivett` set in Inter Tight 700, lowercase, tracked `-0.05em`, followed by an accent dot. The dot is `0.32em` × `0.32em`, perfect circle, `--accent`, translated `+0.04em` on Y to sit on the baseline. The dot is the signature.

Locked behaviours:

- Always lowercase. Never `Rivett`, never `RIVETT`.
- The dot is always `--accent` (never `--accent-deep`, never `--ink`).
- The dot always trails. Never leads.
- The dot is always a perfect circle. Never `•`, `·`, or `‧`.
- One wordmark dot per page. The 8-px stamp dot is the only allowed echo.
- The dot is never animated, stroked, or gradiented.

Minimum size: 14px (footer use). Below 14px, swap to the B1 mark.

File: [`assets/wordmark.svg`](./assets/wordmark.svg) (ink) and [`assets/wordmark-inverse.svg`](./assets/wordmark-inverse.svg) (paper-on-ink).

### 4.2 B1 mark · favicon

An 80×80 **green circle** carrying a lowercase `r` in Inter Tight 700, tracked -0.05em, centred at `cx=40 cy=40`. The plate fills with `--accent` (#8FBF3F). The `r` is `--on-ink` (#FFFFFF) — the white-on-green seal is the primary mark; an ink-on-green variant exists for the rare case the favicon lands on a busy / dark backdrop.

Used as favicon, app icon, social avatar, and any context where the wordmark must render below 14px.

File: [`assets/rivet-b1.svg`](./assets/rivet-b1.svg) (white r — primary) and [`assets/rivet-b1-inverse.svg`](./assets/rivet-b1-inverse.svg) (ink r — alternate).

> This supersedes the previous square-ink-plate-with-stroked-rivet-glyph treatment from `02-identity.html`. The original artwork is preserved in [`spec/originals/`](./spec/originals/) for reference.

### 4.3 Stamps

The mono label is the system's stamp. Always uppercase, `--track-mono` (0.22em), preceded by an 8-px `--accent` dot. Two words after the dot is the maximum. Three is too many.

Variants: default (`--accent-deep` on paper), neutral (`--ink-faint`), on-dark (`--on-ink-faint` text, accent dot).

---

## 5 · Index — what's in this folder

```
rivett-design/
├── README.md                  ← you are here
├── SKILL.md                   ← agent-facing skill brief
├── design.md                  ← the canonical written system (12 sections)
├── voice.md                   ← short voice & mark field guide
├── CHANGELOG.md               ← version history + commit convention
├── ACCESSIBILITY.md           ← WCAG 2.2 AA conformance brief + audit cadence
├── tokens.css                 ← canonical CSS custom properties + base resets
├── tokens.json                ← machine-readable token export (for design tools)
├── components.css             ← root-level component layer for production code
├── colors_and_type.css        ← thin semantic layer over tokens.css (fg-1, h2, etc)
├── assets/
│   ├── wordmark.svg           ← Inter Tight 700 wordmark + dot
│   ├── wordmark-inverse.svg
│   ├── rivet-b1.svg           ← favicon / B1 mark (green circle + white r)
│   ├── rivet-b1-inverse.svg   ← alternate (green circle + ink r)
│   ├── icons.svg              ← 24-icon sprite (use href="…#ic-NN-name")
│   ├── icons/                 ← 24 individual SVG files
│   └── favicon/               ← favicon.ico (16/32/48 pack) + PNG raster
│                                exports — 16/24/32/48/180/512 +
│                                apple-touch-icon, og-image-1200x630
├── fonts/
│   ├── README.md              ← self-host instructions
│   ├── fonts.css              ← @font-face stub (activate once WOFF2s drop in)
│   └── fetch-fonts.mjs        ← one-command WOFF2 fetcher (Node 18+)
├── preview/                   ← small cards rendered into the Design System tab
├── spec/
│   ├── 00-hub.html            ← the design system website hub
│   ├── 01-foundations.html    ← color · type · spacing · motion · grid
│   ├── 02-identity.html       ← wordmark · B1 · favicon · clear space · misuse
│   ├── 03-components.html     ← buttons · forms · cards · tables · FAQ · modal
│   ├── 04-patterns.html       ← hero · section heads · TLDR · numbox · pull · end-CTA
│   ├── 05-templates.html      ← home · blog · post · MRI · diagnostic · 404
│   ├── 06-voice.html          ← do/don't · italic rule · numbers · microcopy
│   ├── 07-icons.html          ← 24-icon library · anatomy · sizes · misuse
│   ├── templates/             ← working template pages (home, post, mri)
│   └── originals/             ← preserved source uploads (audit, v0.2 guide, comps)
└── ui_kit/
    ├── marketing/             ← React/JSX recreation of the homepage
    ├── mri/                   ← Revenue MRI — flagship product page, interactive
    ├── blog/                  ← Field Notes index + single post
    ├── diagnostic/            ← Booking form, pricing card, FAQ
    └── 404/                   ← Error page with most-likely destinations
```

### Entry points

- **If you are shipping a page** → `<link rel="stylesheet" href="tokens.css">` then `<link rel="stylesheet" href="components.css">`. Compose from `spec/03-components.html` and `spec/04-patterns.html`. If your page matches one of the templates, copy from `ui_kit/<surface>/`.
- **If you are writing copy** → read `voice.md` and `design.md` §7. The italic rule, the numbers rule, the no-marketer-words list are non-negotiable.
- **If you are an agent prototyping** → read `SKILL.md`, then this README §1–4, then look at `ui_kit/marketing/` for ready-built React components and `ui_kit/mri/` for an interactive product surface.
- **If you want to see it all rendered** → open `spec/00-hub.html`.
- **If you want machine-readable tokens** → `tokens.json`. Schema is documented inline.

---

## 6 · Caveats

- **WOFF2 fonts are one command away.** Run [`node fonts/fetch-fonts.mjs`](./fonts/fetch-fonts.mjs) (Node 18+, project root) to pull Inter Tight, Newsreader, and DM Mono from Google Fonts into [`fonts/`](./fonts/), then swap the `@import` at the top of `tokens.css` for `@import url('./fonts/fonts.css');`. The `@font-face` stub already exists. We can't ship the binaries in this folder directly because they're fetched from an external CDN at install time.
- **The icon set is exactly 24.** If you need a vital not represented (e.g. "ledger", "permit"), reach for the second-best fit before adding. Additions replace existing members of the same family. See [`spec/07-icons.html`](./spec/07-icons.html) §07.7 for the expansion ritual.

— *TR*, *Cape Town. 2026·05*
