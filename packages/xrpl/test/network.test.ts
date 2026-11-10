import { describe, expect, it } from 'vitest';
import { assertTestnetEndpoint, NetworkPolicyError, testnetEndpoints } from '../src/network.js';

describe('assertTestnetEndpoint', () => {
  it('accepts both allow-listed testnet endpoints, with or without a trailing slash', () => {
    expect(assertTestnetEndpoint('wss://s.altnet.rippletest.net:51233')).toBe(
      'wss://s.altnet.rippletest.net:51233',
    );
    expect(assertTestnetEndpoint('wss://s.altnet.rippletest.net:51233/')).toBe(
      'wss://s.altnet.rippletest.net:51233',
    );
    expect(assertTestnetEndpoint('wss://testnet.xrpl-labs.com/')).toBe(
      'wss://testnet.xrpl-labs.com',
    );
  });

  it('refuses the mainnet, unknown hosts and other ports', () => {
    expect(() => assertTestnetEndpoint('wss://xrplcluster.com')).toThrow(NetworkPolicyError);
    expect(() => assertTestnetEndpoint('wss://s.altnet.rippletest.net:443')).toThrow(
      NetworkPolicyError,
    );
    expect(() => assertTestnetEndpoint('wss://evil.example.com')).toThrow(NetworkPolicyError);
  });

  it('refuses insecure schemes, credentials, queries and fragments', () => {
    expect(() => assertTestnetEndpoint('ws://testnet.xrpl-labs.com')).toThrow('only wss://');
    expect(() => assertTestnetEndpoint('https://testnet.xrpl-labs.com')).toThrow('only wss://');
    expect(() => assertTestnetEndpoint('wss://user:pass@testnet.xrpl-labs.com')).toThrow(
      'credentials',
    );
    expect(() => assertTestnetEndpoint('wss://testnet.xrpl-labs.com/?token=1')).toThrow(
      'query or fragment',
    );
    expect(() => assertTestnetEndpoint('wss://testnet.xrpl-labs.com/#x')).toThrow(
      'query or fragment',
    );
  });

  it('refuses text that is not a URL', () => {
    expect(() => assertTestnetEndpoint('not a url')).toThrow('not a URL');
  });

  it('lists the allow-list in configured order, primary first', () => {
    expect(testnetEndpoints()).toEqual([
      'wss://s.altnet.rippletest.net:51233',
      'wss://testnet.xrpl-labs.com',
    ]);
  });
});
