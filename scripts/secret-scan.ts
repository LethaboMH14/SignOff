// Entry point for `npm run secrets:scan` and the pre-commit hook. The logic lives in lib/.
import { runSecretScanCli } from './lib/secret-scan.js';

const outcome = await runSecretScanCli(process.argv.slice(2), process.cwd());

for (const line of outcome.stdout) process.stdout.write(`${line}\n`);
for (const line of outcome.stderr) process.stderr.write(`${line}\n`);
process.exitCode = outcome.exitCode;
