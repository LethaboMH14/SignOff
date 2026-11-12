import { describe, expect, it } from 'vitest';
import { Wallet } from 'xrpl';
import { assertFeeWithinCap, signAsSigner } from '../src/multisig.js';
import { MAX_FEE_DROPS } from '../src/constants.js';

const wallet = Wallet.generate();
const payment = (fee: string | undefined) => ({
  TransactionType: 'Payment' as const,
  Account: wallet.address,
  Destination: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe',
  Amount: '1000000',
  Sequence: 1,
  ...(fee === undefined ? {} : { Fee: fee }),
});

describe('the fee cap every signer enforces (D-099)', () => {
  it('signs a transaction whose fee is within the cap, such as the 36 drops seen on Testnet', () => {
    expect(() => {
      assertFeeWithinCap(payment('36'));
    }).not.toThrow();
    expect(signAsSigner(wallet, payment('36') as never)).toMatch(/^[0-9A-F]+$/);
  });

  it('refuses a fee above the cap, and signs nothing', () => {
    const above = (BigInt(MAX_FEE_DROPS) + 1n).toString();
    expect(() => {
      signAsSigner(wallet, payment(above));
    }).toThrow(/above the cap/);
  });

  it('refuses a transaction with no fee or a malformed fee', () => {
    expect(() => signAsSigner(wallet, payment(undefined) as never)).toThrow(/no fee/);
    expect(() => signAsSigner(wallet, payment('-1') as never)).toThrow(/no fee/);
  });
});
