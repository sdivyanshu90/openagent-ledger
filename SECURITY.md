# Security Policy

Please report vulnerabilities privately through GitHub Security Advisories rather than a public issue. Include affected versions, reproduction steps, impact, and any suggested mitigation. Maintainers will acknowledge a complete report and coordinate disclosure after a fix is available.

This pre-1.0 local workbench has no user authentication and must not be exposed directly to an untrusted network. It binds to loopback by default. Never put real secrets in scenarios or demo data. See `docs/security.md` for implemented controls and trust boundaries.
