import { describe, expect, it, vi } from 'vitest';
import { NetworkPolicyError } from '../src/network.js';

// The connection tests replace the network client with a stand-in that answers server_info from a table.
const network = vi.hoisted(() => ({
  networkIds: new Map<string, number>(),
  failConnect: new Set<string>(),
  disconnected: [] as string[],
}));

vi.mock('xrpl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xrpl')>();
  class StandInClient {
    constructor(private readonly url: string) {}

    connect(): Promise<void> {
      if (network.failConnect.has(this.url)) {
        return Promise.reject(new Error('connection refused'));
      }
      return Promise.resolve();
    }

    request(req: { readonly command: string }): Promise<unknown> {
      if (req.command !== 'server_info') {
        return Promise.reject(new Error('not expected in this test'));
      }
      return Promise.resolve({
        result: {
          info: {
            network_id: network.networkIds.get(this.url) ?? 1,
            validated_ledger: {
              seq: 7,
              base_fee_xrp: 0.00001,
              reserve_base_xrp: 1,
              reserve_inc_xrp: 0.2,
            },
          },
        },
      });
    }

    disconnect(): Promise<void> {
      network.disconnected.push(this.url);
      return Promise.resolve();
    }
  }
  return { ...actual, Client: StandInClient };
});

const { connectFirstAvailable, connectTestnetPort } = await import('../src/xrpl-port.js');
const PRIMARY = 'wss://s.altnet.rippletest.net:51233';
const SECONDARY = 'wss://testnet.xrpl-labs.com';

describe('connectTestnetPort', () => {
  it('connects to an allow-listed testnet endpoint and reads from it', async () => {
    const port = await connectTestnetPort(PRIMARY);
    expect(port.endpoint).toBe(PRIMARY);
    expect(await port.networkId()).toBe(1);
  });

  it('refuses a mainnet endpoint before opening any connection', async () => {
    await expect(connectTestnetPort('wss://xrplcluster.com')).rejects.toThrow(NetworkPolicyError);
  });

  it('closes the connection and refuses when the endpoint reports another network', async () => {
    network.networkIds.set(SECONDARY, 0);
    network.disconnected.length = 0;
    await expect(connectTestnetPort(SECONDARY)).rejects.toThrow(
      'does not report the testnet network ID',
    );
    expect(network.disconnected).toContain(SECONDARY);
    network.networkIds.delete(SECONDARY);
  });
});

describe('connectFirstAvailable', () => {
  it('uses the primary when it answers, and the secondary when the primary does not', async () => {
    const first = await connectFirstAvailable();
    expect(first.endpoint).toBe(PRIMARY);
    network.failConnect.add(PRIMARY);
    const fallback = await connectFirstAvailable();
    expect(fallback.endpoint).toBe(SECONDARY);
    network.failConnect.delete(PRIMARY);
  });

  it('refuses when no endpoint answers, and says how each one failed', async () => {
    network.failConnect.add(PRIMARY);
    network.failConnect.add(SECONDARY);
    await expect(connectFirstAvailable()).rejects.toThrow(
      'no testnet endpoint answered (Error, Error)',
    );
    network.failConnect.clear();
  });
});
