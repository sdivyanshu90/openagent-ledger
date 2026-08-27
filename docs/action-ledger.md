# Action Ledger

The ledger distinguishes intent from effect. A consequential tool call follows `PROPOSED → PREVIEWED → AWAITING_CONFIRMATION → APPROVED → EXECUTING → EXECUTED → VERIFIED`; rejection, failure, and `ROLLED_BACK` are explicit terminal branches. `state-machine.ts` rejects impossible transitions.

Each entry records actor, tool/schema fingerprint, redacted arguments, reason, risk, resource, side effects, before/after preview, confirmation policy, provenance IDs, execution result, and transition history. Entries link to their predecessor. Every transition also links to and hashes its predecessor, making accidental alteration detectable. This is tamper-evident, not a cryptographic non-repudiation service; an administrator controlling both data and application keys can rewrite local data.

Approval is not a modal result. The runtime requires an unpredictable token, compares it in constant time, checks its persisted hash, verifies current ledger state, and then rechecks the resource revision. Duplicate approvals return the completed result without executing again. A changed resource records `FAILED` and no mutation occurs.

`close_issue` stores its prior issue value and supports one real rollback. Undo requires `VERIFIED`, a reversible definition, and the expected post-execution revision. It restores the previous state with a new revision and becomes idempotent at `ROLLED_BACK`. `delete_issue` never advertises undo.

Sensitive keys and bearer-shaped strings are recursively redacted before persistence. The current controls do not replace application authorization, encrypted storage, signed external audit logs, or retention policy.
