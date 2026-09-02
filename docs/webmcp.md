# WebMCP Integration

OpenAgent Ledger follows OpenAI's current WebMCP guidance: tools are registered from the live page with `document.modelContext.registerTool()`, use narrow JSON Schema inputs, describe side effects, and return results the agent can verify. ChatGPT and the user therefore operate on the same visible issue state and authenticated browser session.

## Registered capabilities

- `search_issues` and `get_issue` are marked with `annotations.readOnlyHint: true` and never mutate state.
- `close_issue` and `delete_issue` require a reason and stable idempotency key. Invocation creates a proposal; it does not execute the action.

`src/domain/tool-registry.ts` is canonical. `src/client/webmcp.ts` registers the exact descriptors returned to Tool Explorer and used by the runtime. When contract mode changes, React aborts the old registration set and immediately registers the new canonical descriptors. Browser tests inspect the captured native descriptor after this switch. Unsupported browsers show **Simulation mode · native unavailable** while navigation, scenarios, ledger, and structured reads remain usable.

## Human-control boundary

The server validates every input, records a hash-linked proposal, and returns a sanitized agent result. Raw approval secrets never leave server memory. Execution requires an explicit in-page decision from the same HttpOnly human session, an unexpired single-use grant, a matching resource revision, and—when irreversible—the typed issue ID. Idempotency keys deduplicate proposals. The server verifies resulting state; reversible closes can be undone. Normal application authorization remains required in a real deployment—browser mediation and the demo session cookie are not authentication substitutes.

The internal tool model also carries risk, scopes, reversibility, and confirmation metadata that are not asserted to be WebMCP standards. Keeping them behind the adapter lets the draft evolve without coupling domain logic to a browser API.

References: [OpenAI WebMCP documentation](https://learn.chatgpt.com/docs/webmcp) and the [WebMCP Community Group draft](https://webmachinelearning.github.io/webmcp/).
