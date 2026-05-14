# UI kit · Marketing surface

A click-thru recreation of the Rivett homepage, factored into small, reusable React components. This is the canonical reference for *how the marketing surface looks and feels when assembled.* It is not production code — it is a hi-fi mockup that an agent can mine for component patterns.

Open [`index.html`](./index.html) to see it composed. The "Book diagnostic →" CTAs open a working modal (form → saved confirmation → close).

## File layout

```
ui_kit/marketing/
├── index.html        ← entry. Loads tokens.css, kit.css, then the JSX modules.
├── kit.css           ← component-scoped CSS for the kit.
├── icons.jsx         ← <Icon name="diagnostic" size={36} />  · all 24 icons
├── elements.jsx      ← <Wordmark>, <Stamp>, <Button>
├── chrome.jsx        ← <Nav>, <SiteFooter>, <BookDiagnosticModal>
├── blocks.jsx        ← <Hero>, <SecHead>, <ModuleCard>, <AutoRow>,
│                       <Numbox>, <AudienceCol>, <Pull>, <NoteCard>,
│                       <EndCTA> — the editorial primitives
└── app.jsx           ← MarketingHome — composes the whole page
```

Each `.jsx` file ends with `Object.assign(window, { … })` so components are visible to scripts loaded after them. Order in `index.html` is dependency order: icons → elements → chrome → blocks → app.

## Components

### Atomic — `elements.jsx`

- **`<Wordmark size="md|sm|lg" inverse href>`** — `rivett·` with the accent dot. The dot scales with `em` so the proportion is locked.
- **`<Stamp variant="default|neutral|on-ink">{children}</Stamp>`** — the mono label. Always uppercase. Always preceded by an 8-px accent dot. Two-word maximum after the dot.
- **`<Button variant="solid|secondary|inverse" size="md|sm" arrow>{children}</Button>`** — three button variants. Never four. The `arrow` prop appends a trailing `→`.

### Icons — `icons.jsx`

- **`<Icon name="diagnostic" size={36} />`** — strokes inherit `currentColor`. All 24 icons from the canonical set are bundled. See [`spec/07-icons.html`](../../spec/07-icons.html) for anatomy.

### Chrome — `chrome.jsx`

- **`<Nav activeId onNav onBookDiagnostic>`** — wordmark · 4 links · primary CTA. Never sticky.
- **`<SiteFooter />`** — dark plate. Four columns. The wordmark uses the inverse paper-on-ink colourway.
- **`<BookDiagnosticModal open onClose>`** — full-bleed `rgba(14,26,44,0.78)` overlay, paper card, single `[ESC] Close` chip top-right. Click-thru: form → "Saved" stamp + reply-within-48hr block → close.

### Blocks — `blocks.jsx`

The editorial primitives. Each one is a pattern from `spec/04-patterns.html`:

- **`<Hero stamp headline dek primary secondary onPrimary onSecondary>`** — display-size h1 with italic clause, dek, two actions.
- **`<SecHead label num>{h2}</SecHead>`** + **`<SecBody>`** — the 240/1fr numbered section opener with the `--bw-rule` top border.
- **`<ModuleTriad>`** + **`<ModuleCard icon code headline italic body metaLeft metaRight>`** — the three-card service module strip.
- **`<AutomateList>`** + **`<AutoRow icon title body>`** — the two-column "what I do on a Tuesday" list.
- **`<Numbox items={[{k, v, u}…]}>`** — the sage-tinted four-cell stat block with the 3-px accent-deep left rail.
- **`<AudienceTriad>`** + **`<AudienceCol stamp headline italic body>`** — three-up audience targeting block.
- **`<Pull quote citation>`** — the Newsreader-italic pull quote with top + bottom hairlines.
- **`<NotesGrid>`** + **`<NoteCard code headline italic body date readTime>`** — three-up field-notes card grid.
- **`<EndCTA headline italic stamp body cta onClick>`** — the mandatory dark closer. Always last.

## Caveats

- **Hi-fi mock, not production code.** Components take props but skip prop-types, accessibility refinements beyond `aria-labels`, and any real router. The `<Nav>` `activeId` is wired but only swaps visual state.
- **Single page.** This kit covers the homepage. Blog, post and MRI templates exist as static HTML under [`../../spec/templates/`](../../spec/templates/); they have not been factored into JSX. If you need to recreate one of those surfaces from these components, the editorial primitives in `blocks.jsx` cover most of it.
- **Modal is one-deep.** No focus trap, no body-scroll lock — the brand spec calls for these on real builds (`design.md` §10 accessibility), but they're out of scope for a static demo.
- **No icons beyond the 24.** If you reach for an icon that isn't in `ICONS`, the component logs a warning and renders nothing. That is intentional — see the icon expansion rules in `spec/07-icons.html`.
