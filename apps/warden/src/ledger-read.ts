import {
  desiredSignerList,
  diffSignerList,
  LSF_DISABLE_MASTER,
  type LedgerPort,
  type RegistryAccount,
} from '../../../packages/xrpl/src/index.js';

/** The ledger flag that freezes every trust line of an issuer. */
const LSF_GLOBAL_FREEZE = 0x00400000;
/** Account flags that change what a payment needs: a destination tag, or trust-line authorization. */
const LSF_REQUIRE_DEST_TAG = 0x00020000;
const LSF_REQUIRE_AUTH = 0x00040000;

/** What the Warden reads about one trust line before it signs. */
export interface TrustFacts {
  readonly balance: string;
  /** Receiving-limit amount reported by the validated ledger, not an immutable loss cap. */
  readonly limit: string;
  readonly frozenByIssuer: boolean;
  readonly frozenByHolder: boolean;
}

/** Everything the pre-signing check needs. Read from the ledger at the moment of decision, never cached. */
export interface PreSigningFacts {
  readonly spendingExists: boolean;
  readonly masterDisabled: boolean;
  readonly regularKeyPresent: boolean;
  readonly signerListMatches: boolean;
  readonly issuerGlobalFreeze: boolean;
  readonly spendingLine: TrustFacts | null;
  readonly destinationExists: boolean;
  readonly destinationLine: TrustFacts | null;
  /** The issuer requires every holder to be authorized. This payment does not perform that step, so it is held. */
  readonly issuerRequiresAuth: boolean;
  /** The payee requires trust-line authorization. Held, for the same reason. */
  readonly destinationRequiresAuth: boolean;
  /** The payee requires a destination tag on every payment to it. */
  readonly destinationRequiresDestTag: boolean;
  /** The destination tag the enrolled payee has, or null. Compared with the payee's flags before signing. */
  readonly enrolledDestinationTag: number | null;
}

export interface PreSigningRequest {
  readonly spending: string;
  readonly destination: string;
  readonly issuer: string;
  readonly ledgerCurrency: string;
  readonly agent: RegistryAccount;
  readonly warden: RegistryAccount;
  /** The destination tag the enrolled payee has, or null when it has none. */
  readonly destinationTag: number | null;
}

/**
 * Reads the account and trust-line facts. A read that fails throws: the caller turns that into a hold, so
 * an unreadable ledger never leads to a signature.
 */
export async function readPreSigning(
  port: LedgerPort,
  request: PreSigningRequest,
): Promise<PreSigningFacts> {
  const asset = { currency: request.ledgerCurrency, issuer: request.issuer };
  const spending = await port.account(request.spending);
  const destination = await port.account(request.destination);
  const issuer = await port.account(request.issuer);
  const spendingLine = await port.trustLine(request.spending, asset);
  const destinationLine = await port.trustLine(request.destination, asset);
  const signers = desiredSignerList(request.agent, request.warden);
  return {
    spendingExists: spending !== null,
    masterDisabled: spending !== null && (spending.flags & LSF_DISABLE_MASTER) !== 0,
    regularKeyPresent: spending === null ? true : spending.regularKeyPresent,
    signerListMatches:
      spending !== null && diffSignerList(signers, spending.signerList).length === 0,
    issuerGlobalFreeze: issuer !== null && (issuer.flags & LSF_GLOBAL_FREEZE) !== 0,
    spendingLine:
      spendingLine === null
        ? null
        : {
            balance: spendingLine.balance,
            limit: spendingLine.limit,
            frozenByIssuer: spendingLine.frozenByIssuer,
            frozenByHolder: spendingLine.frozenByHolder,
          },
    issuerRequiresAuth: issuer !== null && (issuer.flags & LSF_REQUIRE_AUTH) !== 0,
    destinationRequiresAuth: destination !== null && (destination.flags & LSF_REQUIRE_AUTH) !== 0,
    destinationRequiresDestTag:
      destination !== null && (destination.flags & LSF_REQUIRE_DEST_TAG) !== 0,
    enrolledDestinationTag: request.destinationTag,
    destinationExists: destination !== null,
    destinationLine:
      destinationLine === null
        ? null
        : {
            balance: destinationLine.balance,
            limit: destinationLine.limit,
            frozenByIssuer: destinationLine.frozenByIssuer,
            frozenByHolder: destinationLine.frozenByHolder,
          },
  };
}
