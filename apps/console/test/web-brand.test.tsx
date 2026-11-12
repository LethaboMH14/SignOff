import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { initialsOf, roleWordOf } from '../web/App.js';
import { AgentFlow, Brand, BrandMark, FLOW_STATIONS } from '../web/Brand.js';
import { featuredOf, nextRowsOf } from '../web/DeskView.js';
import { Intro } from '../web/Intro.js';
import { Login } from '../web/Login.js';
import type { DeskRow, DisplayState } from '../src/model/desk.js';

/** Runs a render with a window that answers the reduced-motion question as the test asks. The tests run in node. */
function withMotion<T>(reduced: boolean, run: () => T): T {
  const scope = globalThis as unknown as { window?: unknown };
  const had = 'window' in scope;
  const previous = scope.window;
  scope.window = { matchMedia: () => ({ matches: reduced }) };
  try {
    return run();
  } finally {
    if (had) {
      scope.window = previous;
    } else {
      delete scope.window;
    }
  }
}

function rowOf(state: DisplayState, id: string): DeskRow {
  return {
    rowId: id,
    invoiceRef: `INV-${id}`,
    attemptId: null,
    supplierId: null,
    amountMinor: 100000,
    currency: 'USD',
    displayState: state,
    reasonCode: null,
    reason: 'No problem found at this step.',
    modelCalls: null,
    updatedAt: '2026-11-11T09:00:00.000Z',
  };
}

describe('the logo', () => {
  it('keeps the mark out of assistive technology and sets the name in words', () => {
    expect(renderToStaticMarkup(<BrandMark />)).toContain('aria-hidden="true"');
    const logo = renderToStaticMarkup(<Brand />);
    expect(logo).toContain('class="brand"');
    expect(logo).toContain('>SignOff</span>');
  });
});

describe('the agent flow', () => {
  it('names the four stations in order, and says what the flow means', () => {
    const markup = withMotion(false, () => renderToStaticMarkup(<AgentFlow />));
    expect(FLOW_STATIONS.map((station) => station.label)).toEqual([
      'Intake',
      'Extractor',
      'Warden',
      'Ledger',
    ]);
    for (const station of FLOW_STATIONS) {
      expect(markup).toContain(`>${station.label}</text>`);
    }
    expect(markup).toContain('role="img"');
    expect(markup).toContain('Paid only after validation.');
  });

  it('moves three tokens along the path, with the Warden pulse, when motion is allowed', () => {
    const markup = withMotion(false, () => renderToStaticMarkup(<AgentFlow />));
    expect(markup.split('<animateMotion').length - 1).toBe(3);
    expect(markup).toContain('class="flow-pulse"');
  });

  it('places the tokens at rest, with no motion, for a person who asks for reduced motion', () => {
    const markup = withMotion(true, () => renderToStaticMarkup(<AgentFlow />));
    expect(markup).not.toContain('animateMotion');
    expect(markup).not.toContain('flow-pulse');
    expect(markup.split('class="flow-token"').length - 1).toBe(3);
  });
});

describe('the opening', () => {
  it('plays for a person who has not asked for reduced motion, hidden from assistive technology', () => {
    const markup = withMotion(false, () => renderToStaticMarkup(<Intro />));
    expect(markup).toContain('class="intro"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('>S</span>');
  });

  it('is not rendered at all for a person who has asked for reduced motion', () => {
    expect(withMotion(true, () => renderToStaticMarkup(<Intro />))).toBe('');
  });
});

describe('the sign-in page', () => {
  it('says in words, beside the flow and before the form, that nothing is paid', () => {
    const markup = renderToStaticMarkup(<Login onSignedIn={() => undefined} />);
    const words = markup.replace(/<!-- -->|<[^>]+>/g, '');
    expect(words).toContain('SIMULATED — no payment is executed');
    expect(markup.indexOf('no payment is executed')).toBeLessThan(markup.indexOf('signin-card'));
  });
});

describe('the console header', () => {
  it('shows two letters of the username and the role in words', () => {
    expect(initialsOf('alice')).toBe('AL');
    expect(roleWordOf('operator')).toBe('Operator');
    expect(roleWordOf('viewer')).toBe('Viewer');
  });
});

describe('which invoice comes first on the desk', () => {
  it('puts the first invoice that needs a person in front, and otherwise the first invoice', () => {
    const paid = rowOf('Paid', 'p');
    const held = rowOf('Held', 'h');
    const waiting = rowOf('Needs a person', 'n');
    expect(featuredOf([paid, held, waiting])).toBe(held);
    expect(featuredOf([paid, rowOf('In progress', 'i')])).toBe(paid);
    expect(featuredOf([])).toBeNull();
  });

  it('lists the next three invoices after the featured one, and never the featured one', () => {
    const rows = [
      rowOf('Paid', 'a'),
      rowOf('Held', 'b'),
      rowOf('In progress', 'c'),
      rowOf('Paid', 'd'),
      rowOf('Refused', 'e'),
    ];
    const featured = featuredOf(rows);
    const next = nextRowsOf(rows, featured);
    expect(next).toHaveLength(3);
    expect(next).not.toContain(featured);
    expect(next.map((row) => row.rowId)).toEqual(['a', 'c', 'd']);
  });
});
