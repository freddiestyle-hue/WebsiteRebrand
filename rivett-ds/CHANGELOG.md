# Changelog

All notable changes to the Rivett design system are recorded here. The system follows [semver](https://semver.org/): MAJOR for breaking token / API changes, MINOR for additions, PATCH for fixes.

The reviewer of record is TR. Every entry must name the area it touches and the reason it shipped.

---

## v1.0.0 — 2026·05 (current)

**Canonical. Supersedes v0.2 entirely.**

### Added
- Full token set: surface, ink, on-ink, accent, signal, type, spacing, motion, focus (112 tokens).
- 24-icon library, four families of six, with sprite + per-icon SVGs.
- B1 mark: **green-circle plate with a white lowercase `r`** (Inter Tight 700, -0.05em, centred). Replaces the v0.2 square-ink-plate-with-rivet-glyph treatment. Ink-on-green variant available as an alternate for busy backdrops.
- 11 component patterns: buttons, forms, cards, nav, tables, modal, FAQ, numbox, TLDR, pull quote, end-CTA.
- 8 page templates: home, blog index, post, MRI, diagnostic, case study, 404, email.
- Voice rules: do/don't lists, italic-clause rule, numbers convention, lexicon, swap list, microcopy library.
- `tokens.json` — machine-readable token export.
- `components.css` — root-level component layer for production code.
- React UI kit covering the marketing surface.
- `favicon.ico` (16/32/48 pack) + PNG export set (16/24/32/48/180/512) + Open Graph card (1200×630).
- `fonts/fetch-fonts.mjs` — one-command WOFF2 fetcher for self-hosting.

### Changed
- Accent `#6FB582 → #8FBF3F`.
- Accent-deep `#3F7553 → #4A6E18`.
- Default radius `4px → 0`. Square geometry is now the brand law.
- B1 mark: see Added.

### Removed
- The "AI-powered", "growth-hack" lexicon from v0.2 copy.
- Decorative cuts of Newsreader and Inter Tight (italic-only for the serif; no fourth family).
- `box-shadow` defaults on cards (cards are hairline-bordered only).

---

## v0.2.0 — 2025·11

### Changed
- Accent migrated `#6FB582 → #8FBF3F`.
- Accent-deep migrated `#3F7553 → #4A6E18`.
- Favicon switched from abstract peak to rivet-stroke B1 (the version v1.0 superseded).

### Added
- 12-icon set introduced.

---

## v0.1.0 — 2025·08

First style guide. Tokens were embedded in component CSS; no separate stylesheet.

---

## Commit convention

Every change to tokens, components, or icons ships as one commit with a reviewer. Format:

```
area: change · reason

  tokens:     bump --accent · brighter at 11px mono on paper
  icons:      add ic-25 · CONTRACT · replaces ic-16 · ARCHIVE
  components: extract <Numbox> from home template
```

Areas: `tokens`, `icons`, `components`, `patterns`, `templates`, `voice`, `ui-kit`, `docs`.
