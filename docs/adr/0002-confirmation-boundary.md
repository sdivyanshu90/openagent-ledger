# ADR 0002: Server-side confirmation capability

Status: accepted.

Treat approval as a short-lived capability, not UI state. Persist only its hash, retain the random token in process/client memory, and validate it plus action state and resource revision immediately before mutation. Restart fails closed and requires a rerun.
