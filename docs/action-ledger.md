# Action Ledger

The ledger distinguishes intent from effect. A consequential tool call follows `PROPOSED → PREVIEWED → AWAITING_CONFIRMATION → APPROVED → EXECUTING → EXECUTED → VERIFIED`; rejection, execution/verification failure, `ROLLED_BACK`, and `ROLLBACK_FAILED` are explicit terminal branches. `state-machine.ts` rejects impossible transitions.

Each entry records actor, tool/schema fingerprint, redacted arguments, reason, risk, resource, side effects, before/after preview, confirmation policy, provenance IDs, execution result, and transition history. Entries link to their predecessor. Every transition also links to and hashes its predecessor, making accidental alteration detectable. This is tamper-evident, not a cryptographic non-repudiation service; an administrator controlling both data and application keys can rewrite local data.

Approval is not a modal result. The runtime holds an unpredictable server-only grant bound to the action, human session, preview revision, and expiry. The raw credential never enters tool output, DOM, logs, URLs, snapshots, or exports. Concurrent or repeated approvals execute at most once and later attempts fail as used. A changed resource records `FAILED` and no mutation occurs. Deletion also requires a server-validated issue-ID acknowledgement.

`close_issue` stores its prior issue value and supports one real rollback. Undo requires `VERIFIED`, a reversible definition, and the expected post-execution revision. It restores the previous state with a new revision and becomes idempotent at `ROLLED_BACK`. A conflict records `ROLLBACK_FAILED` instead of claiming success. `delete_issue` never advertises undo.

The UI presents labelled forensic fields and a readable transition timeline beside raw JSON. **Verify integrity** recalculates every entry, result, and transition link; **Test broken fixture** changes only an in-memory clone; **Export signed JSON** emits redacted evidence plus an Ed25519 signature and public key.

Sensitive keys and bearer-shaped strings are recursively redacted before persistence. The current controls do not replace application authorization, encrypted storage, signed external audit logs, or retention policy.
