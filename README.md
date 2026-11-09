# SignOff

SignOff is a proposed accounts payable assistant for a Lusaka solar distributor paying suppliers in South Africa. It will read invoices, check them against purchasing records, and propose payments within limits set by a finance operator. A separate Warden service will enforce the rules before an XRPL Testnet payment.

**Status as of 9 November 2026:** planning and research. No application, validated payment, customer validation, partner integration, or product mockups have been verified. The names and examples in the demo are fictional. See [BUILD-BRIEF.md](BUILD-BRIEF.md) for the current agreed plan and [research](docs/RESEARCH.md) for sources.

Start with the build brief, then review the [historical Claude plan](docs/CLAUDE-PLAN.md) and [evidence](docs/CLAUDE-EVIDENCE.md). Historical files contain earlier hypotheses and proposed directions. The build brief takes precedence where they differ.

## Competition requirements

The Ripple Agentic Finance MVP requires an autonomous transaction on XRPL Testnet or Devnet, limits enforced outside the agent's control, and a way for a human operator to set or change those limits. Judges score Product, Technical and Business separately, out of 30 each.

The supplied participant guide lists a mandatory checkpoint on 9 November at 17:00 SAST and a final submission on 13 November at 23:59 SAST. Confirm current timing in BuilderBase. The final entry requires a public repository and a video of at most three minutes.
