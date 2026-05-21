// One-off verification for the Upgrade 2 rendered-DOM backbone.
// Runs runAudit against real domains over the real network, confirms the
// static path is robust, and — when a headless render is available locally
// — shows which checks flip once the audit reads the fully-rendered DOM
// instead of the static HTML.
//
// Run: npx tsx scripts/verify-rendered-dom.ts

import { runAudit, type AuditResult } from '../src/utils/audit/engine';
import { runHeadlessCheck } from '../src/utils/audit/headless-check';

const DOMAINS = ['https://rivett.tech', 'https://example.com'];

function summary(label: string, r: AuditResult): AuditResult | null {
  if (r.error) {
    console.log(`  ${label}: ERROR — ${r.error}`);
    return null;
  }
  const passed = r.checks.filter((c) => c.passed).length;
  console.log(
    `  ${label}: ${passed}/${r.checks.length} checks pass · score ${r.scorePercent}% · ${r.durationMs}ms`,
  );
  return r;
}

for (const url of DOMAINS) {
  console.log(`\n=== ${url} ===`);

  const staticRun = summary('static-only ', await runAudit(url));

  let headlessHtml: string | undefined;
  try {
    const h = await runHeadlessCheck(url);
    headlessHtml = h?.renderedHtml;
    console.log(
      `  headless     : ${h ? `rendered ${h.renderedHtml.length} bytes` : 'unavailable locally (sparticuz chromium is Linux-only)'}`,
    );
  } catch (e) {
    console.log(`  headless     : failed — ${e instanceof Error ? e.message : String(e)}`);
  }

  if (headlessHtml && staticRun) {
    const renderedRun = summary('rendered-DOM ', await runAudit(url, { renderedHtml: headlessHtml }));
    if (renderedRun) {
      const flipped = renderedRun.checks.filter((c) => {
        const s = staticRun.checks.find((x) => x.id === c.id);
        return s && s.passed !== c.passed;
      });
      if (flipped.length === 0) {
        console.log('  delta        : no checks changed — this site is server-rendered, static and rendered agree');
      } else {
        for (const c of flipped) {
          const s = staticRun.checks.find((x) => x.id === c.id)!;
          console.log(`  delta        : ${c.id} ${s.passed ? 'PASS→FAIL' : 'FAIL→PASS'} (${c.label})`);
        }
      }
    }
  } else {
    console.log(
      '  delta        : rendered-DOM path covered by engine-rendered-dom.test.ts; real-site delta runs on Vercel where headless executes',
    );
  }
}
