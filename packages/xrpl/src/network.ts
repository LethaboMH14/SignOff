import { TESTNET_ENDPOINTS } from './constants.js';

/** Thrown before any connection is attempted when an endpoint or network is not allowed. */
export class NetworkPolicyError extends Error {
  constructor(reason: string) {
    super(`Network policy refused: ${reason}`);
    this.name = 'NetworkPolicyError';
  }
}

/** Canonical form of a websocket URL: scheme, host (with port) and path without trailing slashes. */
function canonical(url: URL): string {
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

const ALLOWED: ReadonlySet<string> = new Set(
  TESTNET_ENDPOINTS.map((entry) => canonical(new URL(entry))),
);

/**
 * Returns the canonical testnet endpoint for a configured URL, or throws. Only wss:// URLs on the
 * allow-list pass; credentials, queries and fragments are refused outright.
 */
export function assertTestnetEndpoint(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NetworkPolicyError('endpoint is not a URL');
  }
  if (url.protocol !== 'wss:') {
    throw new NetworkPolicyError('only wss:// endpoints are allowed');
  }
  if (url.username !== '' || url.password !== '') {
    throw new NetworkPolicyError('credentials in the endpoint are not allowed');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new NetworkPolicyError('query or fragment in the endpoint is not allowed');
  }
  const key = canonical(url);
  if (!ALLOWED.has(key)) {
    throw new NetworkPolicyError('endpoint is not on the testnet allow-list');
  }
  return key;
}

/** The allow-list in canonical form, in configured order (primary first). */
export function testnetEndpoints(): readonly string[] {
  return TESTNET_ENDPOINTS.map((entry) => canonical(new URL(entry)));
}
