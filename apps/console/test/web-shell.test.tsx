import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from '../web/App.js';
import { MapView } from '../web/MapView.js';

describe('the app shell', () => {
  it('asks who is signed in before it shows anything else', () => {
    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain('Checking your sign-in');
    expect(markup).not.toContain('Sign out');
  });

  it('shows the agents map with its connection line before the stream connects', () => {
    const markup = renderToStaticMarkup(<MapView />);
    expect(markup).toContain('Waiting for the server');
    expect(markup).toContain('Where each invoice is');
  });
});
