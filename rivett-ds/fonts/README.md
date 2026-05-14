# Fonts

The system uses three families, loaded via Google Fonts in `tokens.css`:

- **Inter Tight** — 400 / 500 / 600 / 700 / 800
- **Newsreader** — 400 / 500 / 400 italic / 500 italic
- **DM Mono** — 300 / 400 / 500

This folder is the **drop site** for self-hosted WOFF2 files. The system spec calls for self-hosting before launch (see `design.md` §11 engineering contract).

## How to self-host

1. Pull WOFF2s from the Google Fonts API or the [google-webfonts-helper](https://gwfh.mranftl.com/fonts) tool. For each family, grab the weights listed above. Filenames should follow the pattern below:

   ```
   fonts/
   ├── inter-tight-400.woff2
   ├── inter-tight-500.woff2
   ├── inter-tight-600.woff2
   ├── inter-tight-700.woff2
   ├── inter-tight-800.woff2
   ├── newsreader-400.woff2
   ├── newsreader-500.woff2
   ├── newsreader-400-italic.woff2
   ├── newsreader-500-italic.woff2
   ├── dm-mono-300.woff2
   ├── dm-mono-400.woff2
   └── dm-mono-500.woff2
   ```

2. Replace the `@import` at the top of `tokens.css` with the `@font-face` block in `fonts.css` (in this folder). Then `@import url('./fonts/fonts.css');` from `tokens.css`.

3. Verify with `document.fonts.ready` — every weight should resolve before the page paints headings.

## Why self-host

- **Performance.** No third-party DNS / TLS handshake.
- **Privacy.** Google Fonts records IPs on each request. EU traffic prefers self-host.
- **Resilience.** If `fonts.googleapis.com` 502s, you still ship type.

## License notes

All three families are open-source under SIL Open Font License 1.1. You may redistribute them in your build artefacts. Keep the license files alongside the WOFF2s:

```
fonts/
├── LICENSE-inter-tight.txt
├── LICENSE-newsreader.txt
└── LICENSE-dm-mono.txt
```

Download licenses from the same source as the fonts.

## Pending

WOFF2s are **not** included in this folder yet. Until they are, `tokens.css` will keep loading from Google. The `fonts.css` stub below is ready to be activated.
