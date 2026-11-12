import { resolveTxt } from 'node:dns/promises';

import { hold, type Verdict } from '../checks.js';

/**
 * Sender-domain checks (lane H, plan section 6): an exact match of the sender's domain against the supplier's
 * enrolled domain, and DNS email-authentication records (SPF, DKIM when a selector is known, DMARC).
 *
 * DMARC alone passes a lookalike domain the attacker owns, so the exact match is the control that matters.
 * DNS answers are read with Node's resolver. A lookup that fails for any reason other than "no record" is
 * UNKNOWN, and an unknown answer holds (fail closed).
 */

export type DnsRecordState = 'present' | 'absent' | 'unknown';
export type DmarcPolicy = 'reject' | 'quarantine' | 'none' | 'absent' | 'unknown';

export interface SenderPosture {
  readonly domain: string;
  readonly spf: DnsRecordState;
  readonly dmarc: DmarcPolicy;
  /** 'not-checked' when no selector is known. The message's DKIM selector is not available here. */
  readonly dkim: DnsRecordState | 'not-checked';
}

/** Minimal resolver interface so tests can supply fixed answers. The production value is `nodeResolver`. */
export interface TxtResolver {
  resolveTxt(name: string): Promise<string[][]>;
}

export const nodeResolver: TxtResolver = { resolveTxt: (name) => resolveTxt(name) };

/** Lower-cases, trims and removes one trailing dot. Returns '' for an input that is not a plausible domain. */
export function normaliseDomain(input: string): string {
  const domain = input.trim().toLowerCase().replace(/\.$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : '';
}

/** EXACT match of the sender domain against the enrolled domain. No subdomain or lookalike is accepted. */
export function domainMatches(senderDomain: string, enrolledDomain: string): boolean {
  const sender = normaliseDomain(senderDomain);
  const enrolled = normaliseDomain(enrolledDomain);
  return sender !== '' && enrolled !== '' && sender === enrolled;
}

type TxtLookup =
  { state: 'present'; records: string[] } | { state: 'absent' } | { state: 'unknown' };

async function txtRecords(resolver: TxtResolver, name: string): Promise<TxtLookup> {
  try {
    const answers = await resolver.resolveTxt(name);
    return { state: 'present', records: answers.map((parts) => parts.join('')) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ENODATA: the name exists with no TXT. ENOTFOUND: the name does not exist. Both mean "no record".
    if (code === 'ENODATA' || code === 'ENOTFOUND') return { state: 'absent' };
    return { state: 'unknown' };
  }
}

/** Reads SPF, DMARC and (when a selector is given) DKIM for a domain. Pure apart from DNS. */
export async function senderPosture(
  rawDomain: string,
  options: { resolver?: TxtResolver; dkimSelector?: string } = {},
): Promise<SenderPosture> {
  const domain = normaliseDomain(rawDomain);
  if (domain === '') return { domain: '', spf: 'unknown', dmarc: 'unknown', dkim: 'not-checked' };
  const resolver = options.resolver ?? nodeResolver;

  const apex = await txtRecords(resolver, domain);
  const spfRecord =
    apex.state === 'present' ? apex.records.find((r) => /^v=spf1(\s|$)/i.test(r)) : undefined;
  const spf: DnsRecordState =
    apex.state === 'unknown' ? 'unknown' : spfRecord ? 'present' : 'absent';

  const dmarcLookup = await txtRecords(resolver, `_dmarc.${domain}`);
  let dmarc: DmarcPolicy;
  if (dmarcLookup.state === 'unknown') {
    dmarc = 'unknown';
  } else if (dmarcLookup.state === 'absent') {
    dmarc = 'absent';
  } else {
    const record = dmarcLookup.records.find((r) => /^v=DMARC1(\s*;|\s*$)/i.test(r));
    const policy = record
      ?.match(/(?:^|;)\s*p=(reject|quarantine|none)\s*(?:;|$)/i)?.[1]
      ?.toLowerCase();
    dmarc = !record
      ? 'absent'
      : policy === 'reject' || policy === 'quarantine' || policy === 'none'
        ? policy
        : 'none';
  }

  let dkim: DnsRecordState | 'not-checked' = 'not-checked';
  if (options.dkimSelector !== undefined) {
    const selector = options.dkimSelector.trim().toLowerCase();
    if (!/^[a-z0-9-]{1,63}$/.test(selector)) {
      dkim = 'unknown';
    } else {
      const lookup = await txtRecords(resolver, `${selector}._domainkey.${domain}`);
      dkim =
        lookup.state === 'present' && lookup.records.some((r) => /v=DKIM1|p=/.test(r))
          ? 'present'
          : lookup.state === 'unknown'
            ? 'unknown'
            : 'absent';
    }
  }
  return { domain, spf, dmarc, dkim };
}

export interface SenderFacts {
  readonly senderDomain: string;
  readonly enrolledDomain: string;
}

/**
 * The Warden hook. A lookalike or unknown domain holds, and so does missing or unknown email authentication.
 * The check never returns REFUSE: the sender is a question for a person.
 */
export function senderVerdict(facts: SenderFacts, posture: SenderPosture): Verdict | null {
  if (!domainMatches(facts.senderDomain, facts.enrolledDomain)) {
    return hold(
      'PAYEE_NOT_VERIFIED',
      `Sender domain ${normaliseDomain(facts.senderDomain) || '(invalid)'} does not exactly match the enrolled domain. Possible lookalike; a person must check.`,
    );
  }
  if (posture.spf === 'unknown' || posture.dmarc === 'unknown' || posture.dkim === 'unknown') {
    return hold(
      'PAYEE_NOT_VERIFIED',
      'Sender DNS authentication records could not be read. Held until they can.',
    );
  }
  if (posture.spf === 'absent') {
    return hold(
      'PAYEE_NOT_VERIFIED',
      'Sender domain publishes no SPF record. A person must check.',
    );
  }
  if (posture.dmarc !== 'reject' && posture.dmarc !== 'quarantine') {
    return hold(
      'PAYEE_NOT_VERIFIED',
      `Sender domain DMARC policy is ${posture.dmarc}, not quarantine or reject. A person must check.`,
    );
  }
  if (posture.dkim === 'absent') {
    return hold(
      'PAYEE_NOT_VERIFIED',
      'The DKIM key for the message selector is not published. A person must check.',
    );
  }
  return null;
}

/**
 * Soft signal for onboarding only. A disposable domain is not a verdict: the caller records it and a person
 * decides. Never call this from the payment path. The list is supplied by the caller (no list is bundled here).
 */
export function disposableDomainSignal(
  domain: string,
  disposableList: ReadonlySet<string>,
): boolean {
  const normalised = normaliseDomain(domain);
  return normalised !== '' && disposableList.has(normalised);
}
