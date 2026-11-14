import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { BUNDLE_FILES, hostedConfig, packBundle } from './hosted-bundle.js';

describe('the hosted Warden bundle', () => {
  it('makes the hosted Warden listen on every interface on port 8080 and keeps the rest of the config', () => {
    const local = JSON.stringify({
      listen: { host: '127.0.0.1', port: 8789 },
      policyVersion: 'p1',
    });
    expect(JSON.parse(hostedConfig(local))).toEqual({
      listen: { host: '0.0.0.0', port: 8080 },
      policyVersion: 'p1',
    });
  });

  it('packs files so the start script can read them back exactly', () => {
    const files = { 'evidence.json': '{"a":1}\n', 'events.jsonl': 'x\ny\n' };
    const unpacked = JSON.parse(
      gunzipSync(Buffer.from(packBundle(files), 'base64')).toString('utf8'),
    ) as unknown;
    expect(unpacked).toEqual(files);
  });

  it('names exactly the files the Railway start script accepts', async () => {
    const { readFileSync } = await import('node:fs');
    const start = readFileSync(
      new URL('../../deploy/warden/railway-start.mjs', import.meta.url),
      'utf8',
    );
    for (const name of BUNDLE_FILES) {
      expect(start).toContain(`'${name}'`);
    }
  });
});
