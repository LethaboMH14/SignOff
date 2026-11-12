import { describe, expect, it } from 'vitest';

import {
  EDGES,
  isActorNode,
  labelOf,
  MAP_NODES,
  pointOf,
  tokenPosition,
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
