import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CountUp } from '../web/CountUp.js';
import { DeskView } from '../web/DeskView.js';
import {
  COUNT_UP_MS,
  durationOf,
  openingSequenceMs,
  OPENING_LIMIT_MS,
  TRANSITION_MS,
} from '../web/motion.js';
import { StateChip } from '../web/StateChip.js';
import type { DeskData } from '../web/api.js';
import { DISPLAY_STATES } from '../src/model/desk.js';

const NO_OP = (): void => undefined;
const NO_OP_ASYNC = (): Promise<void> => Promise.resolve();
// The stylesheet is the console's own file, at a fixed place in the repository; nothing user-supplied is read.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- the console's own stylesheet at a fixed path
const STYLES = readFileSync(new URL('../web/desk.css', import.meta.url), 'utf8');

function counts(): DeskData['counts'] {
  return Object.fromEntries(DISPLAY_STATES.map((state) => [state, 0])) as DeskData['counts'];
}

const DESK: DeskData = {
  asOf: '2026-11-11T09:00:00.000Z',
  mode: 'simulated',
  damagedLines: 0,
  overview: {
    paused: false,
    policyVersion: '2026-11-10.1',
    limits: { perPaymentMinor: 500000, supplierDailyMinor: 1000000, dailyTotalMinor: 2000000 },
    usageToday: { day: '2026-11-11', totalMinor: 0 },
    pendingLimitChange: null,
  },
  counts: { ...counts(), Paid: 3 },
  rows: [],
};

describe('the timings', () => {
  it('turn every duration to zero for a person who asks for reduced motion', () => {
    expect(durationOf(COUNT_UP_MS, true)).toBe(0);
    expect(durationOf(TRANSITION_MS, true)).toBe(0);
    expect(durationOf(COUNT_UP_MS, false)).toBe(COUNT_UP_MS);
  });

  it('finish the opening sequence within the limit of 1.2 seconds', () => {
    expect(OPENING_LIMIT_MS).toBe(1200);
    expect(openingSequenceMs()).toBeLessThanOrEqual(OPENING_LIMIT_MS);
    expect(openingSequenceMs()).toBe(700);
  });

  it('keep transitions within the specified 180 to 220 milliseconds', () => {
    expect(TRANSITION_MS).toBeGreaterThanOrEqual(180);
    expect(TRANSITION_MS).toBeLessThanOrEqual(220);
  });
});

describe('the stylesheet', () => {
  it('replaces every animation with its final state for reduced motion', () => {
    expect(STYLES).toContain('@media (prefers-reduced-motion: reduce)');
    expect(STYLES).toContain('animation: none !important');
    expect(STYLES).toContain('transition: none !important');
  });

  it('moves a card by a few pixels only, so no content leaves the screen', () => {
    expect(STYLES).toContain('translateY(8px)');
    expect(STYLES).not.toMatch(/translate[XY]\((?:[2-9]\d|\d{3,})px\)/);
  });
});

describe('the Paid tick', () => {
  it('is drawn only on a Paid chip, and that chip also says Paid in words', () => {
    const paid = renderToStaticMarkup(<StateChip state="Paid" />);
    expect(paid).toContain('class="tick"');
    expect(paid).toContain('Paid');
    for (const state of DISPLAY_STATES.filter((candidate) => candidate !== 'Paid')) {
      expect(renderToStaticMarkup(<StateChip state={state} />)).not.toContain('class="tick"');
    }
  });
});

describe('the count-up and the sheet', () => {
  it('shows the final number as text, so the motion adds nothing a reader must see', () => {
    expect(renderToStaticMarkup(<CountUp value={3} />)).toBe('3');
  });

  it('moves focus into the password sheet when it opens', () => {
    const markup = renderToStaticMarkup(
      <DeskView
        data={DESK}
        error={null}
        busy={false}
        pending={{ kind: 'pause', paused: true }}
        onTogglePause={NO_OP}
        onRequestLimits={NO_OP}
        onApprove={NO_OP}
        onConfirm={NO_OP_ASYNC}
        onCancelConfirm={NO_OP}
        onOpen={NO_OP}
        onReceipt={NO_OP}
      />,
    );
    expect(markup).toContain('autofocus=""');
  });
});
