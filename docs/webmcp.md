# WebMCP Integration

OpenAgent Ledger follows OpenAI's current WebMCP guidance: tools are registered from the live page with `document.modelContext.registerTool()`, use narrow JSON Schema inputs, describe side effects, and return results the agent can verify. ChatGPT and the user therefore operate on the same visible issue state and authenticated browser session.

## Registered capabilities

- `search_issues` and `get_issue` are marked with `annotations.readOnlyHint: true` and never mutate state.
- `close_issue` and `delete_issue` require a reason and stable idempotency key. Invocation creates a proposal; it does not execute the action.

`src/client/webmcp.ts` is the browser-specific boundary. It registers the four capabilities, sends invocation to the same validated server runtime used by the UI, and publishes activity back into the page. Unsupported browsers retain the complete workbench experience without claiming native discovery.

## Human-control boundary

The server validates every input, records a hash-linked ledger entry, and returns a sanitized agent result. Approval tokens stay in the human UI path. Execution requires an explicit in-page approval, a matching resource revision, and an unused idempotency key. The server then verifies the resulting state; reversible closes can be undone. Normal application authorization remains required in a real deployment—browser mediation is not an authorization substitute.

The internal tool model also carries risk, scopes, reversibility, and confirmation metadata that are not asserted to be WebMCP standards. Keeping them behind the adapter lets the draft evolve without coupling domain logic to a browser API.

References: [OpenAI WebMCP documentation](https://learn.chatgpt.com/docs/webmcp) and the [WebMCP Community Group draft](https://webmachinelearning.github.io/webmcp/).
