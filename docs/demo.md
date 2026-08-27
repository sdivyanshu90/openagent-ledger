# Flagship Demo

1. Run `npm run demo:reset && npm run dev`, then open `http://localhost:5173` in ChatGPT's WebMCP-capable browser.
2. Ask: “Find resolved login issues.” Show ChatGPT discovering `search_issues`, returning two current records, and the same invocation appearing in **Recent agent activity**.
3. Ask: “Close issue 42 because the reported login problem is resolved.” Show `close_issue` creating a proposal while the issue remains unchanged.
4. In the confirmation dialog, review the target, reason, effects, reversibility, and diff. Approve it. The server checks the revision and one-time approval credential, executes once, and records `VERIFIED`.
5. Open **Trace / Ledger**, show the hash-linked lifecycle, then choose **Undo**. Confirm the issue is restored with `ROLLED_BACK` provenance.
6. Briefly open **Scenarios** and run the flagship eval to show how ambiguous destructive tool descriptions are detected and improved.

The sequence fits a three-minute video and uses no model API key. If native WebMCP is unavailable, the deterministic scenario runner demonstrates the identical ledger and confirmation boundary.
