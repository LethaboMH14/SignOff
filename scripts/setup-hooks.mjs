// Enables the versioned git hooks in .githooks. It runs after "npm install" (the "prepare" script),
// and by hand as "npm run setup:hooks". Outside a git checkout it does nothing, so an archive
// download still installs. Its only change to git is core.hooksPath, set for this clone alone.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HOOKS_DIRECTORY = '.githooks';

async function isGitCheckout() {
  try {
    const { stdout } = await run('git', ['rev-parse', '--is-inside-work-tree']);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function main() {
  if (!(await isGitCheckout())) {
    console.log('setup-hooks: not a git checkout; nothing to enable.');
    return;
  }
  await run('git', ['config', '--local', 'core.hooksPath', HOOKS_DIRECTORY]);
  console.log(`setup-hooks: git hooks enabled from ${HOOKS_DIRECTORY}.`);
}

main().catch((error) => {
  const reason = error instanceof Error ? error.message : 'unknown error';
  console.error(`setup-hooks: could not enable git hooks (${reason}).`);
  process.exitCode = 1;
});
