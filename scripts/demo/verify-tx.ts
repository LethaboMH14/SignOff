// Read-only check of one Testnet transaction, independent of the agent and Warden code: validated or not, result,
// ledger index, delivered amount, issuer, and the signers. It prints the public explorer link for the hash.
// Usage: npm run demo:verify -- <64-hex hash>
import { Client } from 'xrpl';
import {
  connectFirstAvailable,
  RLUSD_TESTNET,
  testnetEndpoints,
} from '../../packages/xrpl/src/index.js';

const HASH = /^[0-9A-F]{64}$/;

async function main(): Promise<void> {
  const hash = (process.argv[2] ?? '').toUpperCase();
  if (!HASH.test(hash)) {
    throw new Error('give one 64-character hexadecimal transaction hash');
  }
  const port = await connectFirstAvailable();
  const client = new Client(port.endpoint);
  await client.connect();
  try {
    const response = (await client.request({ command: 'tx', transaction: hash })) as unknown as {
      result: {
        validated?: boolean;
        ledger_index?: number;
        tx_json?: {
          Signers?: { Signer: { Account: string } }[];
          TxnSignature?: string;
        };
        meta?: { TransactionResult?: string; delivered_amount?: unknown };
      };
    };
    const result = response.result;
    const delivered = result.meta?.delivered_amount;
    const deliveredOk =
      typeof delivered === 'object' &&
      delivered !== null &&
      (delivered as { currency?: string }).currency === RLUSD_TESTNET.currency &&
      (delivered as { issuer?: string }).issuer === RLUSD_TESTNET.issuer;
    process.stdout.write(
      `${JSON.stringify(
        {
          hash,
          endpoint: port.endpoint,
          endpointsConfigured: testnetEndpoints().length,
          validated: result.validated === true,
          engineResult: result.meta?.TransactionResult ?? null,
          ledgerIndex: result.ledger_index ?? null,
          deliveredIsRlusdFromExpectedIssuer: deliveredOk,
          deliveredValue:
            typeof delivered === 'object' && delivered !== null
              ? (delivered as { value?: string }).value
              : (delivered ?? null),
          signersCount: result.tx_json?.Signers?.length ?? 0,
          singleKeySignature:
            result.tx_json?.TxnSignature !== undefined && result.tx_json.TxnSignature !== '',
          explorer: `https://testnet.xrpl.org/transactions/${hash}`,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.disconnect();
    await port.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
