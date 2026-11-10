# Build log

One entry per working session (rule R-19 in [RULES.md](../RULES.md)), newest first. Record what was done, what changed, and what is next. Larger choices get a decision record in [decisions/](../decisions/); smaller ones go in [DECISION-JOURNAL.md](DECISION-JOURNAL.md). At the end of each phase, add a **phase close** entry (rule R-23).

## Entry template

```
### YYYY-MM-DD HH:MM SAST — <who> — <issue IDs>
- Done:
- Changed decisions: (ADR or journal IDs)
- Evidence: (test-log IDs, hashes, PRs)
- Problems / blockers:
- Next:
```

## Phase close template

```
### Phase close: Gate <X> — YYYY-MM-DD
- Gate criteria met: (each criterion with evidence link)
- Not met / carried over:
- Documents updated: (each item in the RULES.md phase-close checklist, or "no change")
- README status table updated: yes / no
- Reviewed by:
```

---

### 2026-11-10 — both — planning, documentation only

- Done: pull requests 1–4 merged (reframe, workshop notes, trust boundaries, reliability, service levels, compliance, review follow-ups, Arduino design). Pull request 5 (formatting fix) open. This pull request adds the working contract: rules, PRD, issues and logs.
- Changed decisions: ADRs 0001–0003 accepted; 0004 accepted as a test plan; 0005 accepted as an optional design direction. Recovery signer removed (journal D-006).
- Evidence: none on the ledger yet. No code exists.
- Problems / blockers: no customer conversation yet; permission-delegation status on Testnet unknown.
- Next: Gate 0 (F1–F5), then Gate A (A1–A4).

### 2026-11-09 — both — research and reframe

- Done: repository created with build brief, historical plan and research index; hackathon rubric and track researched; README rewritten; problem, solution, business, hackathon and engineering documents added (pull request 1).
- Changed decisions: supplier-led positioning and plain multi-signing proposed.
- Evidence: desk research only.
- Next: team review of the reframe.
