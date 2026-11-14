import { describe, expect, it } from 'vitest';

import { OwnerApprovalError, xamanApprover } from '../src/owner-approval.js';

/* The Xaman client against a simulated API: no network, no keys. */

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

function fakeFetch(replies: Reply[]) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchFn = ((url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body === undefined ? null : (JSON.parse(init.body) as unknown) });
    const reply = replies.shift() ?? { status: 500, body: {} };
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: () => Promise.resolve(reply.body),
    } as Response);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const CREATED: Reply = {
  status: 200,
  body: { uuid: 'abc', next: { always: 'https://xumm.app/sign/abc' }, pushed: true },
};

function approver(fetchFn: typeof fetch, links: string[] = []) {
  return xamanApprover({
    apiKey: 'k',
    apiSecret: 's',
    ownerAddress: 'rOwner',
    userToken: 'token',
    expireMinutes: 4,
    pollMs: 0,
    onCreated: ({ link }) => links.push(link),
    fetchFn,
    sleep: () => Promise.resolve(),
  });
}

const REQUEST = { transaction: { TransactionType: 'Payment' }, instruction: 'approve' };

describe('the Xaman owner approver', () => {
  it('asks for a Testnet multisign signature from the owner only, without submitting', async () => {
    const { fetchFn, calls } = fakeFetch([
      CREATED,
      { status: 200, body: { meta: { resolved: true, signed: true }, response: { hex: 'BEEF' } } },
    ]);
    const links: string[] = [];
    await expect(approver(fetchFn, links).collect(REQUEST)).resolves.toBe('BEEF');
    const sent = calls[0]?.body as { options: Record<string, unknown>; user_token: string };
    expect(sent.options).toMatchObject({
      multisign: true,
      submit: false,
      signers: ['rOwner'],
      force_network: 'TESTNET',
    });
    expect(sent.user_token).toBe('token');
    expect(links).toEqual(['https://xumm.app/sign/abc']);
  });

  it('waits while the request is open', async () => {
    const { fetchFn } = fakeFetch([
      CREATED,
      { status: 200, body: { meta: { resolved: false } } },
      { status: 503, body: {} },
      { status: 200, body: { meta: { resolved: true, signed: true }, response: { hex: 'CAFE' } } },
    ]);
    await expect(approver(fetchFn).collect(REQUEST)).resolves.toBe('CAFE');
  });

  it('reports a rejection', async () => {
    const { fetchFn } = fakeFetch([
      CREATED,
      { status: 200, body: { meta: { resolved: true, signed: false }, response: { hex: null } } },
    ]);
    await expect(approver(fetchFn).collect(REQUEST)).rejects.toMatchObject({
      outcome: 'rejected',
    });
  });

  it('reports an expired request', async () => {
    const { fetchFn } = fakeFetch([CREATED, { status: 200, body: { meta: { expired: true } } }]);
    await expect(approver(fetchFn).collect(REQUEST)).rejects.toMatchObject({ outcome: 'expired' });
  });

  it('reports Xaman as unavailable when it refuses the request', async () => {
    const { fetchFn } = fakeFetch([{ status: 401, body: {} }]);
    const error = await approver(fetchFn)
      .collect(REQUEST)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OwnerApprovalError);
    expect((error as OwnerApprovalError).outcome).toBe('unavailable');
  });

  it('reports Xaman as unavailable on an unexpected reply', async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { nothing: true } }]);
    await expect(approver(fetchFn).collect(REQUEST)).rejects.toMatchObject({
      outcome: 'unavailable',
    });
  });
});
