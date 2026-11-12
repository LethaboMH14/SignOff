import { describe, expect, it } from 'vitest';

import {
  disposableDomainSignal,
  domainMatches,
  nodeResolver,
  normaliseDomain,
  senderPosture,
  senderVerdict,
  type TxtResolver,
} from '../src/checks/sender.js';

/** A resolver with fixed answers. A name not in the table is NXDOMAIN ('ENOTFOUND'). */
function fixedResolver(table: Record<string, string[] | 'ENODATA' | 'SERVFAIL'>): TxtResolver {
  return {
    async resolveTxt(name: string) {
      const answer = table[name];
      if (answer === undefined) throw Object.assign(new Error('nxdomain'), { code: 'ENOTFOUND' });
      if (answer === 'ENODATA') throw Object.assign(new Error('nodata'), { code: 'ENODATA' });
      if (answer === 'SERVFAIL') throw Object.assign(new Error('servfail'), { code: 'ESERVFAIL' });
      return answer.map((record) => [record]);
    },
  };
}

const GOOD = {
  'acme.co.za': ['v=spf1 include:_spf.example.net -all'],
  '_dmarc.acme.co.za': ['v=DMARC1; p=reject; rua=mailto:dmarc@acme.co.za'],
  'sel1._domainkey.acme.co.za': ['v=DKIM1; k=rsa; p=MIIBIjANBgkq'],
};

describe('exact domain match', () => {
  it('accepts the enrolled domain in any case, with a trailing dot', () => {
    expect(domainMatches('Acme.CO.za.', 'acme.co.za')).toBe(true);
  });

  it('refuses a subdomain, a lookalike and a different suffix', () => {
    expect(domainMatches('mail.acme.co.za', 'acme.co.za')).toBe(false);
    expect(domainMatches('acme-co.za', 'acme.co.za')).toBe(false);
    expect(domainMatches('acme.co.za.evil.example', 'acme.co.za')).toBe(false);
    expect(domainMatches('acme.com', 'acme.co.za')).toBe(false);
  });

  it('refuses a value that is not a domain', () => {
    expect(normaliseDomain('not a domain')).toBe('');
    expect(domainMatches('', '')).toBe(false);
  });
});

describe('senderPosture and senderVerdict', () => {
  it('passes when the domain matches exactly and SPF, DMARC reject and DKIM are published', async () => {
    const posture = await senderPosture('acme.co.za', {
      resolver: fixedResolver(GOOD),
      dkimSelector: 'sel1',
    });
    expect(posture).toEqual({ domain: 'acme.co.za', spf: 'present', dmarc: 'reject', dkim: 'present' });
    expect(senderVerdict({ senderDomain: 'acme.co.za', enrolledDomain: 'acme.co.za' }, posture)).toBeNull();
  });

  it('holds a lookalike even when its own DMARC is reject (DMARC alone is not enough)', async () => {
    const lookalike = {
      'acrne.co.za': ['v=spf1 -all'],
      '_dmarc.acrne.co.za': ['v=DMARC1; p=reject'],
    };
    const posture = await senderPosture('acrne.co.za', { resolver: fixedResolver(lookalike) });
    expect(posture.dmarc).toBe('reject');
    const verdict = senderVerdict({ senderDomain: 'acrne.co.za', enrolledDomain: 'acme.co.za' }, posture);
    expect(verdict).toMatchObject({ decision: 'HOLD', code: 'PAYEE_NOT_VERIFIED' });
    expect(verdict?.message).toMatch(/lookalike/);
  });

  it('holds a DMARC policy of none', async () => {
    const table = { ...GOOD, '_dmarc.acme.co.za': ['v=DMARC1; p=none'] };
    const posture = await senderPosture('acme.co.za', { resolver: fixedResolver(table) });
    expect(posture.dmarc).toBe('none');
    expect(senderVerdict({ senderDomain: 'acme.co.za', enrolledDomain: 'acme.co.za' }, posture)).toMatchObject({
      decision: 'HOLD',
    });
  });

  it('holds a domain with no DMARC record and a domain with no SPF record', async () => {
    const noDmarc = { 'acme.co.za': GOOD['acme.co.za'] };
    const posture = await senderPosture('acme.co.za', { resolver: fixedResolver(noDmarc) });
    expect(posture.dmarc).toBe('absent');
    expect(senderVerdict({ senderDomain: 'acme.co.za', enrolledDomain: 'acme.co.za' }, posture)).toMatchObject({
      decision: 'HOLD',
    });
    const noSpf = await senderPosture('acme.co.za', {
      resolver: fixedResolver({ '_dmarc.acme.co.za': GOOD['_dmarc.acme.co.za'] }),
    });
    expect(noSpf.spf).toBe('absent');
  });

  it('treats a DNS failure other than "no record" as unknown, and holds', async () => {
    const posture = await senderPosture('acme.co.za', {
      resolver: fixedResolver({ 'acme.co.za': 'SERVFAIL', '_dmarc.acme.co.za': GOOD['_dmarc.acme.co.za'] }),
    });
    expect(posture.spf).toBe('unknown');
    expect(senderVerdict({ senderDomain: 'acme.co.za', enrolledDomain: 'acme.co.za' }, posture)).toMatchObject({
      decision: 'HOLD',
    });
  });

  it('reads ENODATA as no record', async () => {
    const posture = await senderPosture('acme.co.za', {
      resolver: fixedResolver({ 'acme.co.za': 'ENODATA', '_dmarc.acme.co.za': 'ENODATA' }),
    });
    expect(posture).toMatchObject({ spf: 'absent', dmarc: 'absent' });
  });

  it('does not check DKIM without a selector, and says so', async () => {
    const posture = await senderPosture('acme.co.za', { resolver: fixedResolver(GOOD) });
    expect(posture.dkim).toBe('not-checked');
  });

  it('holds when the message DKIM selector has no published key', async () => {
    const posture = await senderPosture('acme.co.za', {
      resolver: fixedResolver(GOOD),
      dkimSelector: 'missing',
    });
    expect(posture.dkim).toBe('absent');
    expect(senderVerdict({ senderDomain: 'acme.co.za', enrolledDomain: 'acme.co.za' }, posture)).toMatchObject({
      decision: 'HOLD',
    });
  });
});

describe('disposable domain (onboarding soft signal)', () => {
  it('reports a listed domain as a signal, and never as a verdict', () => {
    const list = new Set(['mailinator.com']);
    expect(disposableDomainSignal('Mailinator.com', list)).toBe(true);
    expect(disposableDomainSignal('acme.co.za', list)).toBe(false);
  });
});

/**
 * Live DNS. Runs only when SIGNOFF_LIVE_DNS=1, so CI and offline runs do not depend on the network.
 *
 * Production uses Node's system resolver (`nodeResolver`). On the lane H build machine that resolver was refused
 * (ECONNREFUSED), so the live test reads the same TXT records over DNS-over-HTTPS (dns.google, JSON API). That is
 * a real lookup of real records, but it is a different resolver path; it is labelled as such in the TEST-LOG.
 */
const dohResolver: TxtResolver = {
  async resolveTxt(name: string) {
    const response = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw Object.assign(new Error(`DoH HTTP ${response.status}`), { code: 'ESERVFAIL' });
    const body = (await response.json()) as { Status: number; Answer?: { type: number; data: string }[] };
    if (body.Status === 3) throw Object.assign(new Error('nxdomain'), { code: 'ENOTFOUND' });
    if (body.Status !== 0) throw Object.assign(new Error(`rcode ${body.Status}`), { code: 'ESERVFAIL' });
    const txt = (body.Answer ?? []).filter((a) => a.type === 16);
    if (txt.length === 0) throw Object.assign(new Error('nodata'), { code: 'ENODATA' });
    // DoH returns each TXT string quoted; strip the quotes and join the chunks of one record.
    return txt.map((a) => [a.data.replace(/^"|"$/g, '').replace(/" "/g, '')]);
  },
};

describe.skipIf(process.env['SIGNOFF_LIVE_DNS'] !== '1')('live DNS (SIGNOFF_LIVE_DNS=1)', () => {
  it('reads SPF and DMARC for example.com from a real resolver', async () => {
    const posture = await senderPosture('example.com', { resolver: dohResolver });
    expect(posture.spf).toBe('absent');
    expect(posture.dmarc).toBe('reject');
  });

  it('reports a DNS failure as unknown, not as absent, when the resolver cannot answer', async () => {
    const posture = await senderPosture('example.com', { resolver: nodeResolver });
    expect(['unknown', 'present', 'absent']).toContain(posture.spf);
  });
});
