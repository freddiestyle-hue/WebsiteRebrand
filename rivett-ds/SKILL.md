---
name: rivett-design
description: Use this skill to generate well-branded interfaces and assets for Rivett, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

# Rivett · Design skill

Read [`README.md`](./README.md) first — it covers the brand stance, content fundamentals, visual foundations, iconography, and the file index. Then explore as needed.

## Folder map (quick)

- [`README.md`](./README.md) — packaged overview. Stance, voice, foundations, iconography, file index.
- [`design.md`](./design.md) — the canonical 400-line written system. Source of truth for tokens, components, voice, MRI, accessibility, engineering contract.
- [`voice.md`](./voice.md) — short voice & mark field guide (the dot, the italic, the lexicon).
- [`tokens.css`](./tokens.css) — every design value as a CSS custom property. Import this from any HTML you produce — do not invent values.
- [`colors_and_type.css`](./colors_and_type.css) — thin semantic layer over tokens (`--fg-1`, `--bg-2`, `.h1`, `.body`, `.ital`).
- [`assets/`](./assets/) — wordmark, B1 favicon, 24-icon sprite, individual icon SVGs.
- [`spec/`](./spec/) — the design-system website (`00-hub.html` → `07-icons.html`), working templates (`templates/home.html`, `post.html`, `mri.html`), and original source uploads (`originals/`).
- [`ui_kit/marketing/`](./ui_kit/marketing/) — React/JSX recreation of the homepage with reusable components.
- [`preview/`](./preview/) — small per-concept cards that populate the Design System tab.

## How to use this skill

### If you are creating visual artifacts (slides, mocks, prototypes, throwaway HTML)

1. Copy `tokens.css` into your working folder and `<link rel="stylesheet">` it from your HTML. Optionally also include `colors_and_type.css` for the semantic role names.
2. Copy any assets you need from `assets/` (the wordmark, favicon, or specific icons). Reference them with a `<use>` from `icons.svg` or as individual SVGs.
3. Read `README.md` §1 (content fundamentals) before writing any copy. The italic rule, the numbers rule, the no-marketer-words list are non-negotiable.
4. Compose from the components in [`ui_kit/marketing/`](./ui_kit/marketing/) when building marketing surfaces, or the patterns in [`spec/04-patterns.html`](./spec/04-patterns.html) when building anything else.
5. **The system is the brief.** When in doubt, restraint wins. One green. Three families. 24 icons. No emoji. No gradients. No rounded corners except the dot and the pill stamp.

### If you are working on production code

1. Read `design.md` end-to-end. It is the contract.
2. Import `tokens.css` at the root of the app. Component CSS must route every value through a token. Raw hex, raw px, raw ms are bugs.
3. Lift the React components from [`ui_kit/marketing/`](./ui_kit/marketing/) as starting points — they are intentionally cosmetic so you can wire your own props, routing, and state without unpicking layout. They are not production-ready as-is.
4. Honour the engineering contract in `design.md` §11: icons ship as inline SVG + sprite at `/assets/icons.svg`; fonts self-host via Google Fonts WOFF2; every token/component/icon change is a commit with a reviewer (TR).

### If the user invokes this skill with no other guidance

Ask them what they want to build or design. Useful questions:

- Is this a marketing page, a tool surface (like the MRI), or an editorial post?
- Is there a single primary action? (Rivett pages tend to have one — the diagnostic.)
- How much copy do you have? (The voice is dense and specific; rough placeholder copy will look wrong.)
- Do you want this in static HTML or as a React prototype?

Then act as an expert designer who outputs HTML artifacts *or* production code, depending on the need. The brand stance — *"a senior operator, writing late at night. Not a marketer. Not a coach."* — is the lens for every decision.

## Non-negotiables

A short list of things the system enforces by review. Internalise these:

- **One green.** `#8FBF3F` for the dot and hover fills. `#4A6E18` for body text. No second hue.
- **Square geometry.** Default radius is zero. Only `--r-sm` 2px (rare) and `--r-pill` 999px (the dot) are allowed.
- **The italic is the whisper.** Newsreader italic, `--ink-dim`, carries the second clause only. Never bold + italic. Never whole-sentence italic.
- **No em-dashes.** The period replaces them. The en-dash is allowed in numeric ranges only.
- **Numbers, not adjectives.** `£12k`, `02 wks`, `14 days`, `30 markets`. Round only if you don't have the number.
- **No emoji. No exclamation marks. No question marks in headlines (except FAQ).**
- **24 icons.** A 25th must replace an existing member of its family.
- **Wordmark is always lowercase.** `rivett·`. The dot is always `--accent`. Never coloured. Never animated.
- **`I`, not `we`.** Singular practice.
