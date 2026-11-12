// The canonical JSON and hashing helpers live in packages/shared, so the Warden and the agent hash identically.
// This module re-exports them for the Warden's existing imports.
export { canonicalJson, fingerprintOf, sha256Hex } from '../../../packages/shared/src/canonical.js';
