# End-to-End Testing

Playwright builds and launches the real Fastify/React production stack with isolated `.data/e2e.json`. Each test resets deterministic fixtures through the demo API. The Chromium suite covers discovery, preview/confirmation, exact-once execution, undo, contract improvement, and keyboard rejection. It uses roles and visible content, explicit assertions, and no arbitrary sleeps.

Run all flows with `npm run test:e2e`, the keyboard-critical check with `npm run test:a11y`, or one test with `npx playwright test -g "undo"`. Use `npx playwright show-report` after a failure. Retained traces and failure screenshots are stored under `test-results`; CI uploads the HTML report on failure.
