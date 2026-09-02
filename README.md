# OpenAgentLab + Action Ledger

Observe, test, and govern agent-native web application behavior through executable scenarios and a durable record of consequential actions.

The included Acme Issues demo exposes four native site tools to ChatGPT's browser, previews state changes, enforces human confirmation at the server boundary, verifies results, and supports real undo for reversible actions. It requires no model API key.

## Quick start

Prerequisites: Node.js 20 LTS (20.19+) or 22.12+ and npm 10+.

```bash
npm install
cp .env.example .env
npm run demo:reset
npm run dev
```

Open `http://localhost:5173`. Visit **Scenarios**, run “Clean up old resolved issues,” and reject the unsafe `delete_issue` proposal. In **Tools**, inspect `delete_issue`, apply the improved contract, and rerun to observe selection of reversible `close_issue`.

In a WebMCP-capable browser, open the page and ask ChatGPT to search for login issues or close issue 42. The browser discovers `search_issues`, `get_issue`, `close_issue`, and `delete_issue` from the live page. Read tools return verifiable results; write tools create a pending Action Ledger entry and wait for an in-page human approval.

## What works

- Tool Explorer with raw JSON Schema, risk, confirmation, scopes, and findings
- validated, versioned scenarios and deterministic agent execution
- hash-linked Action Ledger lifecycle and observable traces
- server-enforced approval, redaction, stale-preview defense, and idempotency
- reversible issue closing with conflict-safe undo
- evidence-based evaluation and baseline/current comparison
- native WebMCP registration with read-only annotations and a live activity feed
- idempotent mutation proposals that never expose approval credentials to the agent
- canonical live contract refresh after safety improvements
- server-held, expiring, session- and revision-scoped approval grants
- readable ledger forensics, hash-chain verification, safe failure fixture, and signed export
- distinct action outcomes, safety verdicts, and native/deterministic run labels
- guided five-minute judge walkthrough and explicit simulation fallback

## Architecture

`src/domain/` owns schemas, lifecycle, evaluation, and fixtures. `src/server/` provides the action runtime, atomic storage repository, and HTTP API. `src/client/` is the React workbench. `src/client/webmcp.ts` is the only browser-standard-specific boundary. See [architecture](docs/architecture.md), [Action Ledger](docs/action-ledger.md), [evaluations](docs/evals.md), and [security](docs/security.md).

Durable local state defaults to `.data/openagentlab.json`; `DATA_FILE` can relocate it. Atomic rename and an in-process transaction queue prevent partial/local concurrent writes. A multi-instance deployment should replace the `Store` interface with a transactional database and add authentication/authorization.

For a production-like container, run `docker build -t openagent-ledger .` and `docker run --init -p 3000:3000 openagent-ledger`. The image runs as an unprivileged user and includes a health check.

## Commands

```bash
npm run lint               # static analysis
npm run typecheck          # browser and server type checks
npm test                   # unit, integration, and security tests
npm run test:e2e           # Playwright browser flows
npm run test:a11y          # keyboard-critical browser flow
npm run build              # production server and client
npm start                  # serve the production build on :3000
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for extension guidance and [docs/demo.md](docs/demo.md) for the reproducible demonstration. Security reports follow [SECURITY.md](SECURITY.md).

## WebMCP status and roadmap

WebMCP is evolving. This project uses `document.modelContext.registerTool()` when available and otherwise remains fully functional. Compatibility and trust-boundary details are in [docs/webmcp.md](docs/webmcp.md). Next production steps are database-backed multi-tenancy, authentication, and richer report export; this demo does not claim broad browser compatibility.

Licensed under the [MIT License](LICENSE).
