# Accessibility

The Rivett system targets **WCAG 2.2 AA**. Below is the conformance brief — the contract every page is held against. Anything not on this list is out of scope; if you need to extend, talk to TR.

---

## 1 · Colour & contrast

All text colour pairs are tested at AA against `--paper` (#FFFFFF).

| Foreground | Background | Ratio | Pair status |
|---|---|---|---|
| `--ink` (#0E1A2C) | `--paper` | 16.7:1 | AAA · body, headlines |
| `--ink-dim` (#3A4658) | `--paper` | 8.9:1  | AAA · italic clause |
| `--ink-faint` (#7A8597) | `--paper` | 3.9:1  | AA Large (≥18pt or 14pt bold). **Never use for body.** Mono labels at 11px qualify because they are mono-cased — but they are decorative, not informational. |
| `--accent-deep` (#4A6E18) | `--paper` | 5.2:1 | AA · small text safe |
| `--accent` (#8FBF3F) | `--paper` | 2.0:1 | **Fails text.** Used as fill / dot only. Never set type in `--accent`. |
| `--accent-deep` | `--sage` (#E8F0D9) | 4.8:1 | AA · stamp text on numbox |
| `--on-ink` (#FFFFFF) | `--ink` (#0E1A2C) | 16.7:1 | AAA |
| `--on-ink-dim` (0.78α) | `--ink` | ~13.0:1 | AAA |
| `--on-ink-italic` (0.62α) | `--ink` | ~10.4:1 | AAA · italic on dark |
| `--on-ink-faint` (0.55α) | `--ink` | ~9.2:1 | AAA · meta on dark |
| `--signal-halt` (#9A2B2B) | `--paper` | 7.1:1 | AA · error text + halt icon |
| `--signal-warn` (#B8651F) | `--paper` | 4.6:1 | AA Large · MRI amber bars |

### Non-text contrast (WCAG 1.4.11)
- Form input borders use `--ink-faint` (3.9:1 against paper) — meets the 3:1 non-text minimum.
- Hover states swap to `--ink` (16.7:1) or fill darken — always exceeds 3:1.
- The accent dot meets 3:1 against `--paper` (2.0:1 alone fails text but the **adjacent ink wordmark** is what carries semantic meaning; the dot is identification, not content).

---

## 2 · Focus

- `:focus-visible` only. Never `:focus`. Mouse users do not get a ring; keyboard users always do.
- Outline: **2px solid `--accent-deep`** on light surfaces, **2px solid `--accent`** on dark.
- Outline-offset: **2px**, always. Never 0.
- The ring is never replaced with a shadow. It is never removed and re-styled inside.
- Reduced-motion does not affect focus (focus is not animated to begin with).

---

## 3 · Motion

- Every transition is wrapped in `@media (prefers-reduced-motion: no-preference)` — or, equivalently, the global reset in `tokens.css` zeros all `transition-duration`, `animation-duration`, and `animation-iteration-count` under `(prefers-reduced-motion: reduce)`.
- No parallax. No scroll-driven animation. No auto-playing video.
- Hover affordances do not move (no scale, no translate). Colour swap only.

---

## 4 · Type & reading

- Body floor: **16px**. Body-sm at 13.5px is a hard floor — never lower except in mono captions (10.5px).
- Line-height floors: body 1.55, prose 1.65, headlines 1.05–1.18.
- Line length: roughly **60 characters** on body, max 720px (`--page-max-prose`).
- No justified text. No widows mitigated by hand-spacing (`text-wrap: balance` and `text-wrap: pretty` are applied at the type roles).

### Italic
The italic clause (Newsreader italic in `--ink-dim`) is decoration *of phrasing*, not emphasis. Screen readers do not announce it, which is correct — the meaning is in the words, not the slant.

---

## 5 · Interactive targets

- Hit area minimum: **44 × 44 CSS pixels** on touch (WCAG 2.5.5 Level AAA, treated as a floor here).
- Buttons at default size are 11px font + 18×11px padding ≈ 40×40 — bump to large variant (18×26 padding) or add padding to clear 44.
- Links inside body prose are exempt where they sit inline with text (WCAG inline exception).

---

## 6 · Forms

- Every input has a programmatic label (`<label for>` or `aria-label`). Never placeholder-as-label.
- Required is signalled by the **word** `REQUIRED` (mono, `--signal-halt`), not an asterisk.
- Errors use a coloured border *and* a helper string. Never colour alone.
- Validation errors are announced via `aria-live="polite"` on a per-form error region — not via a toast that times out.
- Success is silent + a stamp ("Saved · we'll reply inside 48 hours") — no celebratory colour change.

---

## 7 · Icons

- Icons that carry meaning have `role="img"` and `aria-label`.
- Icons that are decorative (e.g. the `→` on a CTA whose text already says "Read") use `aria-hidden="true"`.
- The accent dot inside the wordmark is `aria-hidden="true"` — the wordmark text "rivett" is the accessible name.

---

## 8 · Keyboard

- All interactive controls reachable in source order. No `tabindex > 0`.
- `tabindex="-1"` is allowed only to programmatically focus a heading after navigation.
- The modal traps focus while open, returns focus to the trigger on close, and closes on `Esc`.
- Skip-to-content link is the first focusable element on long pages — append `<a class="visually-hidden focus:not-sr-only" href="#main">Skip to content</a>` after `<body>`.

---

## 9 · Document structure

- One `<h1>` per page. Section heads are `<h2>` inside a numbered `.spec` row.
- Landmarks: `<header>`, `<nav>`, `<main id="main">`, `<footer>`. Aside `<aside>` is allowed for pull quotes inside long-form.
- Language is set on `<html lang>`. Default `lang="en"`.

---

## 10 · Specifics

- **Pull quote** — `<blockquote>` with the citation in `<cite>`.
- **Pull quote on dark** — same, ring colour swap is handled by the `.on-ink` rebind.
- **Numbox** — semantic `<dl>` is correct when the cells are key/value pairs. The current implementation uses divs; upgrade to `<dl>` before launch.
- **FAQ** — `<details>` / `<summary>`. The custom `+` marker is decorative; the open state is announced by the native element.
- **Pricing chips** — `<data value="…">` is the right element. Wrap currency in `data-value="4000"`.

---

## 11 · Audit cadence

- Per release: re-run an automated contrast pass against every token pair listed in §1.
- Per release: smoke-test every template in `spec/templates/` with the screen-reader VoiceOver rotor at the headings level.
- Per release: keyboard-walk the modal, the FAQ, the audience triad, and the end-CTA. Any control unreachable or any focus loss is a halt-on-merge bug.

---

*— TR · Cape Town. Maintained at* `ACCESSIBILITY.md`.
