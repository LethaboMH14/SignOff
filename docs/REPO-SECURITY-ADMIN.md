# GitHub administrator security checklist

Tracking issue: [#59](https://github.com/LethaboMH14/SignOff/issues/59). Secret-scanning acceptance: [#9](https://github.com/LethaboMH14/SignOff/issues/9).

> **Status (2026-11-11): NOT VERIFIED.** The GitHub integration has repository code write access but cannot change administrator settings. The rulesets API returned an empty list; the branch-protection read returned HTTP 403. These findings do not prove that branch protection is disabled. Only the repository owner can verify the settings in GitHub.

## Required owner actions

1. Under **Settings → Code security** (names vary by GitHub plan and UI), enable native **secret scanning** and **push protection**, plus Dependabot alerts and security updates where available. Verify the controls are enabled. Do not upload example secrets as a test.
2. Under **Settings → Branches** or **Rules → Rulesets**, protect `main` with pull requests and at least one approval from someone other than the author. Require review from the code owners in `.github/CODEOWNERS`, dismiss stale approvals after new changes, and require resolution of review conversations.
3. Require the CI jobs **Format, lint, types, tests and build** and **Dependency audit (high and critical)**. They run in `.github/workflows/ci.yml`. Do not make an optional security job look like a required one without verifying the exact displayed GitHub check name.
4. Restrict bypasses, force pushes and branch deletion. Keep default Actions token permissions read-only and review third-party action access.
5. Enable private vulnerability reporting where available and retain the guidance in `SECURITY.md`.
6. Verify the above in the GitHub UI and record the date, reviewer, applicable plan limitations, and a redacted screenshot or checklist on #59. Only then close #9 / #59 as appropriate.

## Already implemented in repository code

- `npm run check`: formatting, lint, types, local secret scanner, tests with coverage and build.
- `npm audit --audit-level=high` and weekly Dependabot checks.
- Pinned GitHub Actions and least-privilege workflow `contents: read`.
- `.github/CODEOWNERS` review-owner declaration (this document's companion change).

**Not equivalent:** These repository files cannot turn on GitHub's native secret scanning, push protection, or branch protection. Do not treat this PR as evidence that those admin toggles changed. No live payments, Testnet credentials or real Warden connection are involved.
