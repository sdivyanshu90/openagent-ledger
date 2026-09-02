# Security Model

The main threats are confirmation bypass, replay, stale previews, duplicate mutations, malicious persisted input, secret leakage, and misleading audit history.

The browser is untrusted for execution authority. A mutation tool can only create a proposal. The runtime creates a high-entropy approval secret that never leaves server memory and persists only its SHA-256 hash. The grant is bound to one action, resource revision, short-lived human-session cookie, and a five-minute expiry; it is single-use even when approval requests race. Irreversible deletion additionally requires the human to type the target issue ID, and the server validates that acknowledgement. Optimistic revisions reject obsolete previews. Zod validates API and stored data, while recursive redaction removes sensitive keys and bearer credentials from public evidence.

Idempotency keys deduplicate proposals and execution is serialized by the store. Replaying a key returns the existing action without mutation; reusing an approval grant fails. Execution, verification, stale-preview, and rollback failures become explicit ledger states. The absence of an execution route is deliberate: agents cannot bypass the approval endpoint.

The local hash chain covers immutable entry evidence, transition links, execution results, verification results, and rollback results. The workbench can recalculate it, demonstrate failure against a safe tampered clone, and export redacted JSON with an Ed25519 signature and public key. The signing key is process-local, so this is tamper evidence—not durable external non-repudiation. This pre-1.0 demo intentionally has no account authentication, tenant isolation, CSRF protection, encryption at rest, or distributed transaction lock. Use only fictional data. A production deployment needs authenticated identities, per-project authorization, durable key management, a transactional database, rate limiting, retention controls, and monitoring.

Indirect instructions embedded in issue content are treated as untrusted data and are never interpreted by the deterministic adapter. External model adapters must preserve that boundary.
