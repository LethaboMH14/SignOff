import { JSDOM } from 'jsdom';

/**
 * A DOM for the client-rendering tests. Import this module before React, so React sees a window when it loads and wires
 * its event listeners to the root. Only the tests that import it get these globals.
 */
export const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: 'http://127.0.0.1/demo.html#desk',
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  IS_REACT_ACT_ENVIRONMENT: true,
});
