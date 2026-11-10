import type { AccountSet } from 'xrpl';
import {
  AGENT_SIGNER_WEIGHT,
  LSF_DISABLE_MASTER,
  SIGNER_QUORUM,
  WARDEN_SIGNER_WEIGHT,
} from './constants.js';
import { diffSignerList, type SignerListDifference, type SignerListView } from './signer-list.js';
import { buildDisableMaster, buildSignerListSet } from './transactions.js';
import { mustValidate, requireAccount, walletOf, type ProvisionDeps } from './provision.js';
import { sendAndReconcile } from './reliable.js';
import { describeDecision, signedPlan } from './single.js';
import { emptyRegistry, withAccount, type Registry, type RegistryAccount } from './registry.js';

export type SignerDeps = ProvisionDeps;

export class SignerConfigError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SignerConfigError';
  }
}

/** The signer configuration the design requires: Agent 1 + Warden 1, quorum 2, no regular key, master disabled. */
export function desiredSignerList(agent: RegistryAccount, warden: RegistryAccount): SignerListView {
  return {
    quorum: SIGNER_QUORUM,
    entries: [
      { account: agent.address, weight: AGENT_SIGNER_WEIGHT },
      { account: warden.address, weight: WARDEN_SIGNER_WEIGHT },
    ],
  };
}

export interface SignerReport {
  readonly signerList: 'set' | 'present';
  readonly masterDisabled: boolean;
  readonly regularKeyAbsent: boolean;
  readonly masterSignatureRefused: 'tefMASTER_DISABLED' | 'not-run';
  readonly masterSeedRemoved: boolean;
  readonly differences: readonly SignerListDifference[];
}

/** A copy of the account with its seed removed. */
function withoutSeed(account: RegistryAccount): RegistryAccount {
  const copy: { -readonly [K in keyof RegistryAccount]: RegistryAccount[K] } = { ...account };
  delete copy.seed;
  copy.status = 'master-disabled';
  return copy;
}

/**
 * Configures the spending account's signers and proves the result. Order: set the signer list while the
 * master key still signs, disable the master key, read the account back, and show that a master-signed
 * transaction is refused. The master seed is removed only after every check has passed. Re-running is
 * safe: a configured account is verified, not changed.
 */
export async function configureSigners(deps: SignerDeps): Promise<SignerReport> {
  const { port, log } = deps;
  let registry: Registry = (await deps.registry.read()) ?? emptyRegistry();
  const spending = requireAccount(registry, 'spending');
  const agent = requireAccount(registry, 'agent');
  const warden = requireAccount(registry, 'warden');
  const desired = desiredSignerList(agent, warden);

  const before = await port.account(spending.address);
  if (before === null) {
    throw new SignerConfigError(
      'the spending account is not on the ledger; run the provision step first',
    );
  }
  if (before.regularKeyPresent) {
    throw new SignerConfigError(
      'a regular key is set on the spending account; refusing to configure signers',
    );
  }

  let signerList: 'set' | 'present' = 'present';
  let masterSignatureRefused: 'tefMASTER_DISABLED' | 'not-run' = 'not-run';
  if ((before.flags & LSF_DISABLE_MASTER) === 0) {
    if (diffSignerList(desired, before.signerList).length > 0) {
      await mustValidate(
        deps,
        walletOf(spending),
        buildSignerListSet(spending.address, desired.quorum, desired.entries),
        'signers.list-set',
      );
      signerList = 'set';
      log('testnet.signers.list_set');
    }
    await mustValidate(
      deps,
      walletOf(spending),
      buildDisableMaster(spending.address),
      'signers.disable-master',
    );
    log('testnet.signers.master_disabled');

    const probe: AccountSet = { TransactionType: 'AccountSet', Account: spending.address };
    const refusal = await sendAndReconcile(
      await signedPlan(deps, walletOf(spending), probe, 'signers.master-probe'),
      deps,
    );
    if (refusal.kind !== 'rejected' || refusal.engineResult !== 'tefMASTER_DISABLED') {
      throw new SignerConfigError(
        `a master-signed transaction was not refused as expected (${describeDecision(refusal)}); the master seed is kept`,
      );
    }
    masterSignatureRefused = 'tefMASTER_DISABLED';
    log('testnet.signers.master_refused');
  }

  const after = await port.account(spending.address);
  if (after === null) {
    throw new SignerConfigError(
      'the spending account disappeared from the ledger during configuration',
    );
  }
  const differences = diffSignerList(desired, after.signerList);
  const masterDisabled = (after.flags & LSF_DISABLE_MASTER) !== 0;
  const problems = [
    ...differences,
    ...(masterDisabled ? [] : ['master-enabled']),
    ...(after.regularKeyPresent ? ['regular-key'] : []),
  ];
  if (problems.length > 0) {
    throw new SignerConfigError(
      `the ledger does not match the expected signer configuration (${problems.join(', ')})`,
    );
  }

  let masterSeedRemoved = false;
  if (spending.seed !== undefined) {
    registry = withAccount(registry, withoutSeed(spending));
    await deps.registry.write(registry);
    masterSeedRemoved = true;
    log('testnet.signers.master_seed_removed');
  }
  return {
    signerList,
    masterDisabled,
    regularKeyAbsent: !after.regularKeyPresent,
    masterSignatureRefused,
    masterSeedRemoved,
    differences,
  };
}
