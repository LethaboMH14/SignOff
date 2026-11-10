# Contributing

Read [README.md](README.md), [BUILD-BRIEF.md](BUILD-BRIEF.md), [docs/RULES.md](docs/RULES.md) and [AGENTS.md](AGENTS.md) first. The build brief is the agreed plan; the rules are the contract every change must meet.

## Workflow

1. Pick an issue from [docs/ISSUES.md](docs/ISSUES.md) (rule R-16). Branch from `main`. Name the branch for its purpose: `feat/warden-limits`, `fix/duplicate-check`, `docs/problem-evidence`.
2. Keep each pull request small and about one thing.
3. Fill in the pull request template. Say what is real, what is simulated, and what evidence supports each claim.
4. The other team member reviews. Do not merge your own pull request without a review.
5. Merge with a merge commit. Do not squash or rewrite history; judges read the build history.

## Standards

- **Evidence.** Link every factual claim to a source or mark it unverified. Label simulated outcomes as simulated.
- **Secrets.** No keys, seeds, tokens, account identifiers or personal data in commits, logs, issues or ledger memos. See [SECURITY.md](SECURITY.md). Never bypass the pre-commit check with `--no-verify`. If it flags something real, remove the secret; if it flags something false, fix the pattern and add a test.
- **Prior work.** Disclose any pre-existing code. Ideas may be reused; code is written here.
- **Decisions.** A change of direction gets a record in [docs/decisions/](docs/decisions/) marked Proposed until the team agrees.
- **Tests.** Code changes come with tests. A Warden rule is not done until it has a passing case and a failing case.
- **AI assistance.** Commits made with an AI assistant carry a co-author trailer naming it.

## Logs

- Add a build-log entry each working session: [docs/logs/BUILD-LOG.md](docs/logs/BUILD-LOG.md).
- Record smaller decisions in [docs/logs/DECISION-JOURNAL.md](docs/logs/DECISION-JOURNAL.md); bigger ones as a decision record from [the template](docs/decisions/TEMPLATE.md).
- Record evidence-bearing test runs in [docs/logs/TEST-LOG.md](docs/logs/TEST-LOG.md).
- Record security findings and changes in [docs/logs/SECURITY-LOG.md](docs/logs/SECURITY-LOG.md).
- At the end of each gate, run the phase-close checklist in [docs/RULES.md](docs/RULES.md#phase-close-checklist-rule-r-23) and write the phase report (R-24) in [docs/logs/PHASE-REPORTS.md](docs/logs/PHASE-REPORTS.md).

## Before asking for review

- `npm run check` passes locally: formatting, lint, types, tests with coverage, and build.
- No file contains a secret.
- Documents you touched still agree with the build brief, or the pull request says where and why they differ.
