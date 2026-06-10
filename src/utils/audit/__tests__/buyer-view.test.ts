// Assembly-rule tests for the /audit/b buyer view. These encode the kill
// shots from the 2026-06-10 design red-team as permanent regressions:
//   K-01/round-2(a): the lead must never indict a dimension the engine
//                    verified as working.
//   K-04/R2:         a clause is suppressed when a verified detection
//                    elsewhere contradicts it.
//   K-05/R3:         every count is computed, never typed.
//   R1:              soft-absence/inferred rows can never produce accusations.
//   R4:              the money stat renders only on a verified slow paint.

import { describe, expect, it } from 'vitest';
import type { Memo, VerdictCell } from '../memo-schema';
import { assembleBuyerView, isSuppressed, traceTextFor } from '../buyer-view';

function cell(partial: Partial<VerdictCell> & Pick<VerdictCell, 'icon' | 'heading'>): VerdictCell {
  return {
    value: 'x',
    note: 'note',
    checks: [],
    ...partial,
  } as VerdictCell;
}

function memoWith(cells: VerdictCell[], extra: Partial<Memo> = {}): Memo {
  return {
    version: '2.0.0',
    slug: 'example-com-abcdefgh12345678',
    domain: 'example.com',
    generatedAt: '2026-06-01T00:00:00.000Z',
    cover: { kicker: 'k', roman: 'r' },
    verdictCells: cells,
    rankedFixes: [{ rank: 1, what: 'w', why: 'y', effort: 'low', impact: 'high' }],
    personalObservation: { text: 'obs' },
    ...extra,
  } as Memo;
}

// The Euclid shape: slow verified paint, conversion path VERIFIED WORKING,
// tel/scheduling/above-fold CTA verified absent.
function euclidLikeCells(): VerdictCell[] {
  return [
    cell({
      icon: 'bolt',
      heading: 'Page speed',
      note: 'Borderline. 5.9s LCP, 5.1s FCP on mobile.',
      checks: [
        { ok: false, text: 'Largest content paint in 5.9s vs Google "good" threshold 2.5s', reliability: 'verified' },
      ],
    }),
    cell({
      icon: 'eye',
      heading: 'Conversion path',
      note: 'Clicking "Get in touch" reaches a submittable form in one click.',
      checks: [
        { ok: true, text: 'Clicking "Get in touch" reaches a submittable form in one click.', reliability: 'verified' },
        { ok: false, text: 'No tappable phone number on the homepage', reliability: 'verified' },
        { ok: false, text: 'No scheduling link (Calendly or similar) found', reliability: 'verified' },
        { ok: false, text: 'No prominent call-to-action above the fold', reliability: 'verified' },
      ],
    }),
    cell({
      icon: 'mail',
      heading: 'Email reputation',
      note: 'Authenticated, protected, and receiving mail. Outbound lands.',
      checks: [
        { ok: true, text: 'SPF: present (-all)', reliability: 'verified' },
        { ok: true, text: 'DMARC: reject (strongest policy)', reliability: 'verified' },
      ],
    }),
    cell({
      icon: 'search',
      heading: 'Search visibility',
      note: '3 of 10 crawl-and-schema gaps verified.',
      checks: [{ ok: false, text: '/llms.txt missing - returns 404', reliability: 'verified' }],
    }),
    cell({
      icon: 'flag',
      heading: 'Stack',
      note: '12 technologies detected.',
      checks: [{ ok: true, text: 'Analytics: GA4', reliability: 'verified' }],
    }),
  ];
}

describe('K-01 guard: the lead never indicts a verified-working dimension', () => {
  it('states the form works when the engine verified the path', () => {
    const view = assembleBuyerView(memoWith(euclidLikeCells()));
    expect(view.lead.headline).toContain('5.9');
    expect(view.lead.body).not.toMatch(/can't get through|cannot get through|leads nowhere|no way to convert/i);
    expect(view.lead.body).toMatch(/form path itself checks out/i);
    // and the working-path fact is the engine's row verbatim, not a paraphrase
    expect(view.lead.body).toContain('reaches a submittable form in one click');
  });

  it('never invents a form field count', () => {
    const view = assembleBuyerView(memoWith(euclidLikeCells()));
    expect(view.lead.body).not.toMatch(/\bfive[- ]field|\d+\s*(required\s*)?fields\b/i);
  });

  it('leads with the dead-end trace when the engine verified a BROKEN path', () => {
    const cells = euclidLikeCells();
    cells[1] = cell({
      icon: 'eye',
      heading: 'Conversion path',
      note: 'Verified gap.',
      checks: [
        {
          ok: false,
          text: 'Clicking "Get Started" did not reach a submittable form within one click.',
          reliability: 'verified',
        },
      ],
    });
    const view = assembleBuyerView(memoWith(cells));
    expect(view.lead.headline).toMatch(/leads nowhere/i);
    expect(view.lead.receipts.join(' ')).toContain('did not reach a submittable form');
  });
});

describe('R1: soft-absence and inferred rows never produce accusations', () => {
  it('falls back to neutral lead when the only failures are soft-absence', () => {
    const cells: VerdictCell[] = [
      cell({
        icon: 'target',
        heading: 'Measurement',
        note: 'No trackers detected on this render.',
        checks: [{ ok: false, text: 'Meta Pixel not observed', reliability: 'soft-absence' }],
      }),
    ];
    const view = assembleBuyerView(memoWith(cells));
    expect(view.lead.headline).toBe('What I could verify from the outside.');
    expect(view.consequences.find((c) => c.key === 'spend')?.status).toBe('unconfirmed');
    expect(view.consequences.find((c) => c.key === 'spend')?.owner).toBeNull();
  });
});

describe('R2: collision suppression', () => {
  it('suppresses a "no chat" absence when the stack verified a chat tool', () => {
    const chatAbsence = { ok: false, text: 'Live or async chat widget not found', reliability: 'verified' } as const;
    const cells: VerdictCell[] = [
      cell({ icon: 'eye', heading: 'Conversion path', note: 'n', checks: [chatAbsence] }),
      cell({
        icon: 'flag',
        heading: 'Stack',
        note: 'n',
        checks: [{ ok: true, text: 'Support: HubSpot LiveChat (runtime)', reliability: 'verified' }],
      }),
    ];
    const memo = memoWith(cells);
    expect(isSuppressed(memo, chatAbsence)).toBe(true);
    expect(traceTextFor(memo, chatAbsence)).toMatch(/could not confirm/i);
    // and the suppressed row alone must not flip the consequence to a problem
    expect(assembleBuyerView(memo).consequences.find((c) => c.key === 'spend')?.status).toBe('sound');
  });

  it('does not suppress when nothing contradicts the absence', () => {
    const chatAbsence = { ok: false, text: 'Live or async chat widget not found', reliability: 'verified' } as const;
    const memo = memoWith([cell({ icon: 'eye', heading: 'Conversion path', note: 'n', checks: [chatAbsence] })]);
    expect(isSuppressed(memo, chatAbsence)).toBe(false);
  });
});

describe('R3: counts are computed from assembled rows', () => {
  it('problem/sound/unconfirmed counts always sum to 3', () => {
    const view = assembleBuyerView(memoWith(euclidLikeCells()));
    const { problems, sound, unconfirmed } = view.counts;
    expect(problems + sound + unconfirmed).toBe(3);
    expect(view.counts.cellsScanned).toBe(5);
  });

  it('euclid shape computes spend=leaking, find=invisible, land=sound', () => {
    const view = assembleBuyerView(memoWith(euclidLikeCells()));
    expect(view.consequences.find((c) => c.key === 'spend')?.status).toBe('leaking');
    expect(view.consequences.find((c) => c.key === 'find')?.status).toBe('invisible');
    expect(view.consequences.find((c) => c.key === 'land')?.status).toBe('sound');
  });
});

describe('R4: the money stat requires a verified slow paint', () => {
  it('renders the sourced Google stat when LCP > 3s is verified', () => {
    const view = assembleBuyerView(memoWith(euclidLikeCells()));
    expect(view.lead.stat?.source).toMatch(/Google/);
  });

  it('omits the stat when speed is fine', () => {
    const cells = euclidLikeCells().filter((c) => c.icon !== 'bolt');
    const view = assembleBuyerView(memoWith(cells));
    expect(view.lead.stat).toBeNull();
  });
});

describe('appendix', () => {
  it('keeps the stack cell out of the buyer layer', () => {
    const view = assembleBuyerView(memoWith(euclidLikeCells()));
    expect(view.appendixCells.map((c) => c.icon)).toContain('flag');
    expect(view.consequences.flatMap((c) => c.cells.map((x) => x.icon))).not.toContain('flag');
  });
});

describe('problem bodies are built from verified-fail rows only', () => {
  it('never includes a passing check or celebratory note in a problem body', () => {
    const view = assembleBuyerView(memoWith(euclidLikeCells()));
    const spend = view.consequences.find((c) => c.key === 'spend')!;
    expect(spend.body).toBe('');
    const rows = spend.failRows.join(' | ');
    expect(rows).not.toMatch(/reaches a submittable form/i);
    expect(rows).toMatch(/5\.9s/);
    expect(rows).toMatch(/No tappable phone number/i);
  });
});

describe('ads observations never indict', () => {
  it('"no active ads" cannot create or evidence a LEAKING status', () => {
    const cells: VerdictCell[] = [
      cell({
        icon: 'megaphone',
        heading: 'Ads in flight',
        note: 'No active paid Google ads detected for this domain.',
        checks: [{ ok: false, text: 'Google Ads Library: no active creatives', reliability: 'verified' }],
      }),
    ];
    const view = assembleBuyerView(memoWith(cells));
    const spend = view.consequences.find((c) => c.key === 'spend')!;
    expect(spend.status).toBe('sound');
    expect(spend.failRows).toHaveLength(0);
  });
});

describe('verified-pass path rows are quoted verbatim, never paraphrased', () => {
  it('uses the engine row text for a zero-click form-on-homepage path', () => {
    const cells = euclidLikeCells();
    cells[1] = cell({
      icon: 'eye',
      heading: 'Conversion path',
      note: 'Verified path.',
      checks: [
        {
          ok: true,
          text: 'A visitor can submit a form directly on the homepage - zero clicks from landing.',
          reliability: 'verified',
        },
        { ok: false, text: 'No tappable phone number on the homepage', reliability: 'verified' },
      ],
    });
    const view = assembleBuyerView(memoWith(cells));
    expect(view.lead.body).toContain('zero clicks from landing');
    expect(view.lead.body).not.toMatch(/reached it in one click/i);
  });
});
