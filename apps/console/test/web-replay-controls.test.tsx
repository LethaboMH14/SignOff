import { dom } from './helpers/jsdom-setup.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MapEventInput } from '../src/model/states.js';
import { ReplayControls } from '../web/MapView.js';
import { REPLAY_STEP_MS } from '../web/replay.js';

/*
 * The simulated console's replay buttons in a DOM, with a fake clock: a click plays one scripted invoice, one move per
 * step, and the buttons wait until it has finished.
 */

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  container = dom.window.document.createElement('div');
  dom.window.document.body.replaceChildren(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  vi.useRealTimers();
});

function buttonNamed(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((button) =>
    button.textContent.includes(text),
  );
  if (found === undefined) {
    throw new Error(`no button named ${text}`);
  }
  return found;
}

describe('the replay buttons', () => {
  it('play a clean invoice to Paid, one move per step, and lock the buttons meanwhile', () => {
    const moves: MapEventInput[] = [];
    act(() => {
      root.render(
        <ReplayControls
          lastSeq={102}
          onMove={(event) => {
            moves.push(event);
          }}
        />,
      );
    });
    expect(container.textContent).toContain('SIMULATED');
    act(() => {
      buttonNamed('Play a clean invoice').click();
    });
    expect(buttonNamed('Play a clean invoice').disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(REPLAY_STEP_MS * 3);
    });
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.length).toBeLessThan(8);
    act(() => {
      vi.advanceTimersByTime(REPLAY_STEP_MS * 10);
    });
    expect(moves.map((move) => move.toState).at(-1)).toBe('RECONCILED');
    expect(moves.map((move) => move.seq)).toEqual([103, 104, 105, 106, 107, 108, 109, 110]);
    expect(buttonNamed('Play a clean invoice').disabled).toBe(false);
  });

  it('play the bank-detail attack to quarantine', () => {
    const moves: MapEventInput[] = [];
    act(() => {
      root.render(
        <ReplayControls
          lastSeq={0}
          onMove={(event) => {
            moves.push(event);
          }}
        />,
      );
    });
    act(() => {
      buttonNamed('bank-detail change attack').click();
    });
    act(() => {
      vi.advanceTimersByTime(REPLAY_STEP_MS * 3);
    });
    expect(moves.map((move) => move.toState)).toEqual(['RECEIVED', 'QUARANTINED']);
  });

  it('stops a replay that is still running when the map closes', () => {
    const moves: MapEventInput[] = [];
    act(() => {
      root.render(
        <ReplayControls
          lastSeq={0}
          onMove={(event) => {
            moves.push(event);
          }}
        />,
      );
    });
    act(() => {
      buttonNamed('Play a clean invoice').click();
    });
    act(() => {
      root.unmount();
    });
    vi.advanceTimersByTime(REPLAY_STEP_MS * 10);
    expect(moves).toEqual([]);
    // A fresh root for afterEach to unmount.
    root = createRoot(container);
  });
});
