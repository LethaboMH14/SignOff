import { describe, expect, it } from 'vitest';

import {
  EDGES,
  isActorNode,
  labelOf,
  MAP_NODES,
  pointOf,
  sizeOf,
  tokenPosition,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from '../src/model/layout.js';
import { AGENT_ACTORS } from '../src/model/states.js';

describe('the map geometry', () => {
  it('places every agent, and every node that a move can reach', () => {
    for (const actor of AGENT_ACTORS) {
      expect(MAP_NODES).toContain(actor);
      expect(isActorNode(actor)).toBe(true);
      expect(pointOf(actor)).toBeDefined();
    }
    for (const node of ['arrival', 'hold', 'ledger', 'paid'] as const) {
      expect(MAP_NODES).toContain(node);
      expect(isActorNode(node)).toBe(false);
    }
  });

  it('draws every edge between places that exist', () => {
    for (const edge of EDGES) {
      expect(MAP_NODES).toContain(edge.from);
      expect(MAP_NODES).toContain(edge.to);
    }
  });

  it('labels every place', () => {
    for (const node of MAP_NODES) {
      expect(labelOf(node).length).toBeGreaterThan(0);
    }
  });

  it('spreads tokens that share a place, so each one stays visible', () => {
    const xs = [0, 1, 2, 3, 4].map((slot) => tokenPosition('warden', slot).x);
    expect(new Set(xs).size).toBe(xs.length);
    expect(tokenPosition('warden', 0).x).toBe(pointOf('warden').x);
  });
});

describe('a busy tray', () => {
  it('starts a second row instead of running out of its zone', () => {
    const places = Array.from({ length: 14 }, (_, slot) => tokenPosition('hold', slot));
    const xs = places.map((place) => place.x);
    const rows = new Set(places.map((place) => place.y));
    expect(rows.size).toBe(2);
    expect(Math.min(...xs)).toBeGreaterThan(20);
    expect(new Set(places.map((place) => `${String(place.x)},${String(place.y)}`)).size).toBe(14);
  });
});

describe('the cards', () => {
  const box = (node: (typeof MAP_NODES)[number]) => {
    const { x, y } = pointOf(node);
    const { width, height } = sizeOf(node);
    return {
      left: x - width / 2,
      right: x + width / 2,
      top: y - height / 2,
      bottom: y + height / 2,
    };
  };

  it('never overlap each other', () => {
    for (const a of MAP_NODES) {
      for (const b of MAP_NODES) {
        if (a >= b) continue;
        const p = box(a);
        const q = box(b);
        const apart =
          p.right <= q.left || q.right <= p.left || p.bottom <= q.top || q.bottom <= p.top;
        expect(apart, `${a} overlaps ${b}`).toBe(true);
      }
    }
  });

  it('stay inside the drawing', () => {
    for (const node of MAP_NODES) {
      const b = box(node);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(VIEW_WIDTH);
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.bottom).toBeLessThanOrEqual(VIEW_HEIGHT);
    }
  });

  it('show the owner approval and the simulated money legs, labelled as simulated', () => {
    expect(labelOf('approver')).toContain('Owner');
    expect(labelOf('onramp')).toContain('simulated');
    expect(labelOf('payout')).toContain('simulated');
  });
});
