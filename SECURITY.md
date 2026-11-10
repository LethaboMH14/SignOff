# Security

SignOff is a hackathon project on XRPL Testnet. It moves no real funds and is not production software.

## Reporting a problem

Use the repository's Security tab ("Report a vulnerability") if it is available, or contact a maintainer privately through GitHub. Do not put details of a vulnerability, or any key, in a public issue.

## Rules for this repository

- **Testnet only.** No main-network keys or real funds are ever used here.
- **Keys stay out of the repository.** Agent, Warden and operator keys live in a secret manager. They never appear in code, configuration files, logs, model prompts or ledger memos.
- **Separate identities.** The agent and Warden deploy separately. The agent's environment has no access to Warden's key.
- **Untrusted input.** Invoice content is treated as hostile. The model proposes; fixed rules and the ledger decide.
- **Fail closed.** If Warden cannot read the ledger or its own records, it refuses.
- **Public ledger.** Only hashes are written to the ledger. No names, invoice contents or bank details.
- **If a key is exposed.** Rotate it, record the incident in the pull request that fixes it, and re-provision the Testnet accounts.

## Secret protection

Four layers, each able to stop a secret before it lands:

1. **Pre-commit check.** `.githooks/pre-commit` scans the staged content, not the working copy, and refuses the commit on a finding. Git reads the hooks folder once `npm install` (or `npm run setup:hooks`) has run in the clone.
2. **Continuous check.** `npm run secrets:scan` scans every tracked file. It runs inside `npm run check`, so CI runs it on every pull request.
3. **File-name deny list.** Environment files, private keys and keystores are refused by name, whatever they contain. `.env.example` stays allowed as a template.
4. **Provider scanning.** GitHub secret scanning and push protection (a repository setting the owner must enable) catch provider tokens that the local patterns may miss.

The local patterns recognise XRPL family seeds (verified by their checksum, so random text does not match), PEM private-key blocks, GitHub and Anthropic tokens, AWS access key IDs, XRPL hex private keys under a secret keyword, bearer tokens and hard-coded passwords. A finding reports the file, line, column and kind. It never prints the value.

Known limits of the scanner:

- Binary files are not text-scanned. The scan counts them and prints the count, so the gap is never silent.
- A secret that is encoded, split across files, or written in a form no pattern covers will not be found. Provider scanning and review are the other defences.
- Bypassing the hook with `--no-verify` is not allowed. CI runs the same scan, so a bypassed commit still fails the pull request.
- A false positive is fixed by changing the pattern and adding a test. There is no allow-list to hide a finding.

## Known limits

Listed under "Honest limits" in the [README](README.md) and "What the design does not protect against" in [docs/SOLUTION.md](docs/SOLUTION.md).
