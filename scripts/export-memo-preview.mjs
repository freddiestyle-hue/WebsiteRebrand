#!/usr/bin/env node
// Render a self-contained HTML preview of a memo (CSS + SVG sprite inlined).
// Mirrors the v3 IA rendered by src/pages/audit/p/[slug].astro so Fred can
// open the output from Desktop without needing a server.
//
// Usage:
//   node scripts/export-memo-preview.mjs \
//     --memo artifacts/sample-memo.json \
//     --out ~/Desktop/rivett-memo-export/v2.html

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, arr) => {
    if (arg.startsWith('--')) acc.push([arg.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const memoPath = resolve(repoRoot, args.memo ?? 'artifacts/sample-memo.json');
const outPath = (args.out ?? '~/Desktop/rivett-memo-export/v2.html').replace(/^~/, homedir());

const memo = JSON.parse(readFileSync(memoPath, 'utf8'));
const css = readFileSync(resolve(repoRoot, 'public/audit/memo.css'), 'utf8');

// SVG sprite (mirror of [slug].astro). Kept in sync manually — small surface.
const sprite = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="ic-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><circle cx="11" cy="11" r="6"/><path d="m15.5 15.5 4.5 4.5"/></symbol>
    <symbol id="ic-bolt" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></symbol>
    <symbol id="ic-target" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></symbol>
    <symbol id="ic-megaphone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="M3 10v4l11 4V6L3 10z"/><path d="M14 8.5c2 0 3 1.5 3 3.5s-1 3.5-3 3.5"/><path d="M7 14v4l3 1v-4"/></symbol>
    <symbol id="ic-bar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></symbol>
    <symbol id="ic-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.2 4.2M14.2 14.2l4.2 4.2M5.6 18.4l4.2-4.2M14.2 9.8l4.2-4.2"/></symbol>
    <symbol id="ic-mail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><rect x="3" y="5" width="18" height="14"/><path d="m3 6 9 7 9-7"/></symbol>
    <symbol id="ic-phone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><rect x="7" y="2" width="10" height="20" rx="1"/><path d="M11 18h2"/></symbol>
    <symbol id="ic-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="M5 22V3"/><path d="M5 3h12l-3 4 3 4H5"/></symbol>
    <symbol id="ic-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="M2.5 12c2.5-4.5 6-7 9.5-7s7 2.5 9.5 7c-2.5 4.5-6 7-9.5 7s-7-2.5-9.5-7z"/><circle cx="12" cy="12" r="3"/></symbol>
    <symbol id="ic-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></symbol>
    <symbol id="ic-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter"><path d="m4 12 5 5 11-12"/></symbol>
    <symbol id="ic-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter"><path d="m5 5 14 14M19 5 5 19"/></symbol>
    <symbol id="ic-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"><path d="M4 12h15M13 6l6 6-6 6"/></symbol>
  </defs>
</svg>`;

const fmtDate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCFullYear()}·${String(d.getUTCMonth() + 1).padStart(2, '0')}·${String(d.getUTCDate()).padStart(2, '0')}`;
};

const verdictCellsHtml = memo.verdictCells
  .map(
    (cell) => `
    <details class="v">
      <summary>
        <div class="k"><svg class="ic"><use href="#ic-${cell.icon}"/></svg>${cell.heading}</div>
        <div class="g">${cell.value}</div>
        <div class="n">${cell.note}</div>
        ${cell.benchmark ? `<div class="bench">${cell.benchmark}</div>` : ''}
        ${cell.checks.length > 0 ? `<div class="expand"><span class="label">+ Checks</span><span class="chev">↑</span></div>` : ''}
      </summary>
      ${cell.checks.length > 0
        ? `<div class="checks">
            <ul>
              ${cell.checks
                .map(
                  (c) => `<li>
                    <svg class="ic ${c.ok ? 'ok' : 'no'}"><use href="${c.ok ? '#ic-check' : '#ic-x'}"/></svg>
                    <span class="${c.ok ? 'ok' : 'no'}">${c.text}</span>
                  </li>`,
                )
                .join('\n              ')}
            </ul>
          </div>`
        : ''}
    </details>`,
  )
  .join('');

const rankedFixesHtml = memo.rankedFixes
  .map(
    (fix) => `
    <div class="row">
      <div class="rank">F${String(fix.rank).padStart(2, '0')}</div>
      <div class="what">
        <div class="what-h">${fix.what}</div>
        <p class="why">${fix.why}</p>
      </div>
      <div class="effort">Effort<b>${fix.effort}</b></div>
      <div class="impact">Impact<b>${fix.impact}</b></div>
    </div>`,
  )
  .join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Teardown memo · ${memo.domain} · Rivett · v2 preview</title>
<meta name="robots" content="noindex,nofollow" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&family=Newsreader:ital,wght@0,400;0,500;1,400;1,500&display=swap" rel="stylesheet" />
<style>
${css}
</style>
</head>
<body>

${sprite}

<div class="page">
  <nav class="top">
    <div class="l"><a href="#" class="wordmark" aria-label="Rivett, audit index">rivett<span class="dot-mark" aria-hidden="true"></span></a> <b>· Teardown memo</b></div>
    <div class="r">
      <span>By Fred Style</span>
      <span>${fmtDate(memo.generatedAt)}</span>
      <span>id ${memo.slug}</span>
    </div>
  </nav>

  <div class="crumb">
    <a href="#">↑ Audit index</a>
    <span class="sep">/</span>
    <span>p/${memo.slug}</span>
    <span class="sep">/</span>
    <span>pre-baked</span>
    <span class="sep">/</span>
    <span style="color:var(--accent-deep)">v2 preview</span>
  </div>

  <header class="cover">
    <div class="kicker">${memo.cover.kicker}</div>
    <h1 class="cv">
      ${memo.cover.roman}
      ${memo.cover.italic ? `<span class="ital">${memo.cover.italic}</span>` : ''}
    </h1>
    ${memo.cover.dek ? `<p class="cv-dek">${memo.cover.dek}</p>` : ''}

    ${memo.benchmark ? `
    <div class="benchmark-line">
      <span class="score-big">
        <span class="n">${memo.benchmark.scoreNumeric}</span>
        <span class="of">/ ${memo.benchmark.scoreMax ?? 100}</span>
      </span>
      <span>Industry median<b>${memo.benchmark.industryMedian}</b></span>
      <span>Industry<b>${memo.benchmark.industryName}</b> <span class="delta">(n=${memo.benchmark.industryN})</span></span>
      ${memo.benchmark.percentile != null ? `<span>Percentile<b>${Math.round(memo.benchmark.percentile)}th</b></span>` : ''}
    </div>
    ${memo.benchmark.oneLiner ? `<p class="benchmark-oneliner">${memo.benchmark.oneLiner}</p>` : ''}
    ` : ''}

    <div class="cv-sub">
      <div class="cv-meta">
        <div>Domain<b>${memo.domain}</b></div>
        ${memo.companyName ? `<div>Company<b>${memo.companyName}</b></div>` : ''}
        <div>Generated<b>${fmtDate(memo.generatedAt)}</b></div>
      </div>
    </div>
  </header>

  ${memo.screenshots?.homepageDesktop ? `
  <div class="screenshot-frame">
    <img src="${memo.screenshots.homepageDesktop}" alt="${memo.domain} homepage (desktop)" loading="lazy" />
    <div class="meta">
      <span>Homepage<b>${memo.domain}</b></span>
      ${memo.screenshots.capturedAt ? `<span>Captured<b>${fmtDate(memo.screenshots.capturedAt)}</b></span>` : ''}
      ${memo.screenshots.source ? `<span>Source<b>${memo.screenshots.source}</b></span>` : ''}
    </div>
  </div>` : ''}

  <section id="verdict" class="sec sec--tight">
    <div class="sec-head">
      <div class="num">01 · The read</div>
      <div>
        <h2>
          Six dimensions, one verdict each.
          <span class="ital">Tap a cell to see what we checked.</span>
        </h2>
      </div>
    </div>
    <div class="verdict" aria-label="Verdict grid">
      ${verdictCellsHtml}
    </div>
  </section>

  <section id="fixes" class="sec">
    <div class="sec-head">
      <div class="num">02 · Do these first</div>
      <div>
        <h2>
          The three fixes that move the score most.
          <span class="ital">Effort and impact, named.</span>
        </h2>
      </div>
    </div>
    <div class="recs">
      ${rankedFixesHtml}
    </div>
  </section>

  <section id="observation" class="sec">
    <div class="sec-head">
      <div class="num">03 · One last thing</div>
      <div>
        <h2>What I would do first.</h2>
      </div>
    </div>
    <p class="body body--obs">${memo.personalObservation.text}</p>
  </section>

  <aside class="memo">
    <div class="lab">Want to talk it through</div>
    <div>
      <h2>
        Pick a time.
        <span class="ital">Twenty minutes. I'll walk you through the three fixes and answer whatever else is on your mind.</span>
      </h2>
      <p>No deck, no sales motion. You bring questions, I bring the read.</p>
      <div class="actions">
        <a class="btn btn--inv" href="#">Book a call <svg class="ic" style="width:14px;height:14px"><use href="#ic-arrow"/></svg></a>
        <a class="btn" href="#">Reply by email</a>
      </div>
      <div class="sig">
        <b>Fred Style</b>
        rivett.tech · ${fmtDate(memo.generatedAt)}
      </div>
    </div>
  </aside>

  <footer class="foot">
    <span>This memo is an external read of public signals. Not a formal assessment.</span>
    <span>rivett.tech · ${fmtDate(memo.generatedAt)}</span>
  </footer>
</div>

</body>
</html>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
console.log(`wrote ${outPath} · ${html.length.toLocaleString()} bytes · ${memo.verdictCells.length} verdict cells · ${memo.rankedFixes.length} fixes`);
