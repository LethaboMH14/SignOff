# Contributing

Read [README.md](README.md), [BUILD-BRIEF.md](BUILD-BRIEF.md) and [AGENTS.md](AGENTS.md) first. The build brief is the agreed plan.

## Workflow

1. Branch from `main`. Name the branch for its purpose: `feat/warden-limits`, `fix/duplicate-check`, `docs/problem-evidence`.
2. Keep each pull request small and about one thing.
3. Fill in the pull request template. Say what is real, what is simulated, and what evidence supports each claim.
4. The other team member reviews. Do not merge your own pull request without a review.
5. Merge with a merge commit. Do not squash or rewrite history; judges read the build history.

## Standards

- **Evidence.** Link every factual claim to a source or mark it unverified. Label simulated outcomes as simulated.
- **Secrets.** No keys, seeds, tokens, account identifiers or personal data in commits, logs, issues or ledger memos. See [SECURITY.md](SECURITY.md).
- **Prior work.** Disclose any pre-existing code. Ideas may be reused; code is written here.
- **Decisions.** A change of direction gets a record in [docs/decisions/](docs/decisions/) marked Proposed until the team agrees.
- **Tests.** Code changes come with tests. A Warden rule is not done until it has a passing case and a failing case.
- **AI assistance.** Commits made with an AI assistant carry a co-author trailer naming it.

## Before asking for review

- Type check, lint, tests and build pass locally.
- No file contains a secret.
- Documents you touched still agree with the build brief, or the pull request says where and why they differ.
