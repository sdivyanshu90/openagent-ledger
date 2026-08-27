# Security Model

The main threats are confirmation bypass, replay, stale previews, duplicate mutations, malicious persisted input, secret leakage, and misleading audit history.

The browser is untrusted for execution authority. The runtime permits execution only from `AWAITING_CONFIRMATION` with a high-entropy approval token whose SHA-256 hash is stored. Tokens are process-local, compared in constant time, consumed after success, and invalid after restart. Optimistic issue revisions prevent approving an obsolete preview. State transitions deny invalid lifecycle jumps; retry paths are idempotent. Zod validates API and stored data. Recursive redaction removes sensitive keys and bearer credentials. Security headers are enabled and the server binds to loopback.

The local hash chain detects accidental history mutation but is not externally anchored. This pre-1.0 build intentionally has no authentication, tenant isolation, application authorization, encryption at rest, or distributed transaction lock. Do not expose it to an untrusted network. A hosted deployment must add authenticated identities, per-project authorization, CSRF protections appropriate to its auth mechanism, a transactional database, rate limiting, retention controls, externally anchored ledger signatures, and security monitoring.

Indirect instructions embedded in issue content are treated as untrusted data and are never interpreted by the deterministic adapter. External model adapters must preserve that boundary.
