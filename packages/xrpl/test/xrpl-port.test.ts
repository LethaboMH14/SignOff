import { describe, expect, it } from 'vitest';
import { Wallet, type Client } from 'xrpl';
import { FakeClient, FakeLedger } from './helpers/fake-ledger.js';
import { createXrplPort } from '../src/xrpl-port.js';
import {
  buildIssuedPayment,
  buildSignerListSet,
  buildTrustSet,
  buildXrpPayment,
} from '../src/transactions.js';
import { signAsSigner, combineSigned } from '../src/multisig.js';
import type { LedgerPort } from '../src/port.js';

const TOKEN = 'TST';

function setup(): { ledger: FakeLedger; client: FakeClient; port: LedgerPort } {
  const ledger = new FakeLedger();
  const client = new FakeClient(ledger);
  const port = createXrplPort(client as unknown as Client, 'wss://s.altnet.rippletest.net:51233');
  return { ledger, client, port };
}

describe('createXrplPort against the ledger model', () => {
  it('reads the network, the validated ledger, the base fee and the reserves', async () => {
    const { port } = setup();
    expect(await port.networkId()).toBe(1);
    expect(await port.validatedLedgerIndex()).toBeGreaterThan(0);
    expect(await port.baseFeeDrops()).toBe('10');
    expect(await port.reserves()).toEqual({ baseDrops: '1000000', incrementDrops: '200000' });
  });

  it('returns null for an account that does not exist, and a full snapshot for one that does', async () => {
    const { port, ledger } = setup();
    const wallet = Wallet.generate();
    expect(await port.account(wallet.address)).toBeNull();
    await port.fund(wallet);
    const snapshot = await port.account(wallet.address);
    expect(snapshot).toMatchObject({
      address: wallet.address,
      balanceDrops: '100000000',
      sequence: 1,
      ownerCount: 0,
      flags: 0,
      regularKeyPresent: false,
      signerList: null,
    });
    ledger.setRegularKey(wallet.address, Wallet.generate().address);
    expect((await port.account(wallet.address))?.regularKeyPresent).toBe(true);
  });

  it('reads a signer list back as the expected shape', async () => {
    const { port, ledger } = setup();
    const owner = Wallet.generate();
    const agent = Wallet.generate();
    const warden = Wallet.generate();
    for (const wallet of [owner, agent, warden]) {
      ledger.fund(wallet);
    }
    const list = buildSignerListSet(owner.address, 2, [
      { account: agent.address, weight: 1 },
      { account: warden.address, weight: 1 },
    ]);
    const prepared = await port.autofill(list, 0);
    await port.submit(owner.sign(prepared).tx_blob);
    ledger.advance();
    expect((await port.account(owner.address))?.signerList).toEqual({
      quorum: 2,
      entries: [
        { account: agent.address, weight: 1 },
        { account: warden.address, weight: 1 },
      ],
    });
  });

  it('reads a trust line, and returns null when the holder has none', async () => {
    const { port, ledger } = setup();
    const issuer = Wallet.generate();
    const holder = Wallet.generate();
    ledger.fund(issuer);
    ledger.fund(holder);
    const token = { currency: TOKEN, issuer: issuer.address };
    expect(await port.trustLine(holder.address, token)).toBeNull();
    const prepared = await port.autofill(
      buildTrustSet(holder.address, { ...token, value: '500' }),
      0,
    );
    await port.submit(holder.sign(prepared).tx_blob);
    ledger.advance();
    expect(await port.trustLine(holder.address, token)).toEqual({ balance: '0', limit: '500' });
  });

  it('follows pagination markers until the line is found', async () => {
    const pages = [
      {
        result: {
          lines: [{ currency: 'OTH', account: 'rX', balance: '1', limit: '1' }],
          marker: 'next',
        },
      },
      { result: { lines: [{ currency: TOKEN, account: 'rIssuer', balance: '7', limit: '70' }] } },
    ];
    const seen: unknown[] = [];
    const paging = {
      request: (req: { marker?: unknown }) => {
        seen.push(req.marker);
        return Promise.resolve(pages[seen.length - 1]);
      },
    } as unknown as Client;
    const port = createXrplPort(paging, 'wss://s.altnet.rippletest.net:51233');
    expect(await port.trustLine('rHolder', { currency: TOKEN, issuer: 'rIssuer' })).toEqual({
      balance: '7',
      limit: '70',
    });
    expect(seen).toEqual([undefined, 'next']);
  });

  it('reports a validated transaction with its result and delivered amount, in each form', async () => {
    const { port, ledger } = setup();
    const issuer = Wallet.generate();
    const holder = Wallet.generate();
    const other = Wallet.generate();
    for (const wallet of [issuer, holder, other]) {
      ledger.fund(wallet);
    }
    const trust = await port.autofill(
      buildTrustSet(holder.address, { currency: TOKEN, issuer: issuer.address, value: '100' }),
      0,
    );
    const trustHash = holder.sign(trust).tx_blob;
    await port.submit(trustHash);
    ledger.advance();
    const trustLookup = await port.lookup((await import('xrpl')).hashes.hashSignedTx(trustHash));
    expect(trustLookup).toEqual({
      status: 'validated',
      engineResult: 'tesSUCCESS',
      ledgerIndex: expect.any(Number) as number,
      delivered: { kind: 'unknown' },
    });

    const iou = await port.autofill(
      buildIssuedPayment(issuer.address, holder.address, {
        currency: TOKEN,
        issuer: issuer.address,
        value: '3',
      }),
      0,
    );
    const iouBlob = issuer.sign(iou).tx_blob;
    await port.submit(iouBlob);
    ledger.advance();
    const iouLookup = await port.lookup((await import('xrpl')).hashes.hashSignedTx(iouBlob));
    expect(iouLookup).toMatchObject({
      status: 'validated',
      delivered: { kind: 'iou', amount: { currency: TOKEN, issuer: issuer.address, value: '3' } },
    });

    const xrp = await port.autofill(buildXrpPayment(holder.address, other.address, '1000'), 0);
    const xrpBlob = holder.sign(xrp).tx_blob;
    await port.submit(xrpBlob);
    ledger.advance();
    expect(await port.lookup((await import('xrpl')).hashes.hashSignedTx(xrpBlob))).toMatchObject({
      delivered: { kind: 'xrp', drops: '1000' },
    });
  });

  it('reports a transaction that is only in an open ledger as not validated, and an unknown hash the same way', async () => {
    const { port, ledger } = setup();
    const wallet = Wallet.generate();
    const other = Wallet.generate();
    ledger.fund(wallet);
    ledger.fund(other);
    const prepared = await port.autofill(buildXrpPayment(wallet.address, other.address, '1'), 0);
    const blob = wallet.sign(prepared).tx_blob;
    const outcome = await port.submit(blob);
    expect(outcome).toEqual({ engineResult: 'tesSUCCESS', accepted: true, applied: true });
    expect(await port.lookup((await import('xrpl')).hashes.hashSignedTx(blob))).toEqual({
      status: 'not-validated',
    });
    expect(await port.lookup('A'.repeat(64))).toEqual({ status: 'not-validated' });
  });

  it('reports a validated failure with its code, and a rejected submission without applying it', async () => {
    const { port, ledger } = setup();
    const wallet = Wallet.generate();
    const other = Wallet.generate();
    ledger.fund(wallet);
    ledger.fund(other);
    ledger.forceNextResult('tecUNFUNDED_PAYMENT');
    const prepared = await port.autofill(buildXrpPayment(wallet.address, other.address, '1'), 0);
    const blob = wallet.sign(prepared).tx_blob;
    await port.submit(blob);
    ledger.advance();
    expect(await port.lookup((await import('xrpl')).hashes.hashSignedTx(blob))).toMatchObject({
      status: 'validated',
      engineResult: 'tecUNFUNDED_PAYMENT',
    });

    const lone = await port.autofill(buildXrpPayment(wallet.address, other.address, '1'), 0);
    const loneBlob = other.sign(lone).tx_blob;
    expect(await port.submit(loneBlob)).toEqual({
      engineResult: 'tefBAD_AUTH',
      accepted: false,
      applied: false,
    });
  });

  it('shows a two-signer blob to the ledger, which refuses it below quorum and accepts it at quorum', async () => {
    const { port, ledger } = setup();
    const owner = Wallet.generate();
    const a = Wallet.generate();
    const b = Wallet.generate();
    const c = Wallet.generate();
    for (const wallet of [owner, a, b, c]) {
      ledger.fund(wallet);
    }
    const list = await port.autofill(
      buildSignerListSet(owner.address, 2, [
        { account: a.address, weight: 1 },
        { account: b.address, weight: 1 },
      ]),
      0,
    );
    await port.submit(owner.sign(list).tx_blob);
    ledger.advance();
    const pay = await port.autofill(buildXrpPayment(owner.address, c.address, '5'), 2);
    const single = combineSigned([signAsSigner(a, pay)]);
    expect((await port.submit(single)).engineResult).toBe('tefBAD_QUORUM');
    const pair = combineSigned([signAsSigner(a, pay), signAsSigner(b, pay)]);
    expect((await port.submit(pair)).engineResult).toBe('tesSUCCESS');
  });

  it('funds a wallet and disconnects without error', async () => {
    const { port } = setup();
    const wallet = Wallet.generate();
    await port.fund(wallet);
    expect(await port.account(wallet.address)).not.toBeNull();
    await expect(port.disconnect()).resolves.toBeUndefined();
  });

  it('passes through errors that are not "not found", so a broken link is never read as an answer', async () => {
    const { port, client } = setup();
    client.online = false;
    await expect(port.account('rAny')).rejects.toThrow('network unreachable');
    await expect(port.lookup('A'.repeat(64))).rejects.toThrow('network unreachable');
    await expect(port.trustLine('rAny', { currency: TOKEN, issuer: 'rIssuer' })).rejects.toThrow(
      'network unreachable',
    );
    await expect(port.submit('AA')).rejects.toThrow('network unreachable');
  });

  it('refuses to report a validated ledger or fee when the endpoint has none', async () => {
    const empty = { request: () => Promise.resolve({ result: { info: {} } }) } as unknown as Client;
    const port = createXrplPort(empty, 'wss://s.altnet.rippletest.net:51233');
    await expect(port.validatedLedgerIndex()).rejects.toThrow('no validated ledger');
    await expect(port.baseFeeDrops()).rejects.toThrow('no validated ledger');
    await expect(port.reserves()).rejects.toThrow('no validated ledger');
    expect(await port.networkId()).toBe(-1);
  });
});
