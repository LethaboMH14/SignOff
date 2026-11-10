import { z } from 'zod';

import { MAX_MINOR_UNITS, SUPPORTED_CURRENCIES } from '../money/minor-units.js';

/** Version of a wire format. Bump it when a schema changes in a way old readers cannot accept. */
export const SchemaVersion = z.literal(1);

/** An ISO 4217-style code for a currency this system can settle. Anything else is rejected. */
export const CurrencyCode = z.enum(SUPPORTED_CURRENCIES);

/** A non-negative whole amount in minor units, within the supported maximum. */
export const MinorUnits = z.int().min(0).max(MAX_MINOR_UNITS);

/** A payable amount: at least one minor unit. */
export const PayableMinorUnits = MinorUnits.min(1);

/** A supplier identifier issued by this system, e.g. SUP-ABC123. */
export const SupplierId = z.string().regex(/^SUP-[A-Z0-9]{4,16}$/);

/** A SHA-256 digest in lower-case hex. */
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/** A unique identifier for one payment attempt. */
export const AttemptId = z.uuid();

/** A dated policy version, e.g. 2026-11-10.1. */
export const PolicyVersion = z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d{1,4}$/);

/** A UTC timestamp with a Z suffix. */
export const IsoInstant = z.iso.datetime();

/** A calendar date, YYYY-MM-DD. */
export const IsoDate = z.iso.date();
