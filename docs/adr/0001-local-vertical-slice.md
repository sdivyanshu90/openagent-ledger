# ADR 0001: Single-application vertical slice

Status: accepted.

Use one TypeScript application with domain, server, client, and adapter boundaries instead of premature monorepo tooling. This minimizes build complexity while keeping packages extractable. Fastify serves a React/Vite production build; an injected repository isolates persistence.
