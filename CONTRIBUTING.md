# Contributing

Use Node 20 LTS (20.19+) or 22.12+. Run `npm install`, copy `.env.example`, reset fixtures with `npm run demo:reset`, then start `npm run dev`. Before opening a pull request, run formatting, lint, typecheck, tests, and the production build.

Keep domain behavior in `src/domain`, execution policy in `src/server/runtime.ts`, and browser-standard code in `src/client/webmcp.ts`. Add an evaluator as a pure evidence-producing function and test both pass and failure evidence. Adding a ledger state requires updating the schema, transition map, runtime behavior, tests, and `docs/action-ledger.md`. Version schema changes; do not silently reinterpret stored records. Add demo tools in `fixtures.ts` and route all mutations through the action runtime.

Use deterministic fixtures and observable assertions. Do not use arbitrary sleeps in browser tests or require external model credentials in core CI. Commit focused changes with imperative subjects. Pull requests must describe impact, link issues, list commands run, flag security/schema changes, and include screenshots for UI changes. Record consequential tradeoffs in `docs/adr/`.
