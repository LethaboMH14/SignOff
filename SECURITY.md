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

## Known limits

Listed under "Honest limits" in the [README](README.md) and "What the design does not protect against" in [docs/SOLUTION.md](docs/SOLUTION.md).
