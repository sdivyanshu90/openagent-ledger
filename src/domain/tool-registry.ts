import type { Database, ToolDefinition } from "./schemas.js";

export type ContractMode = Database["contractMode"];

export function getToolContracts(mode: ContractMode): ToolDefinition[] {
  return [
    {
      version: "1",
      name: "search_issues",
      description:
        "Search issues using an optional title keyword and an optional exact status filter. Filters are combined with AND. For backward compatibility, a query starting with a status such as 'resolved login' is normalized into status='resolved' and query='login'. Results are ordered by issue ID and limited to the requested count without changing application state.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            maxLength: 120,
            description:
              "Optional case-insensitive title keyword or exact numeric issue ID.",
          },
          status: {
            type: "string",
            enum: ["open", "resolved", "closed", "deleted"],
            description: "Optional exact issue status.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 20,
            description: "Maximum number of normalized issues to return.",
          },
        },
        additionalProperties: false,
      },
      risk: "low",
      sideEffects: [],
      reversible: false,
      confirmation: "none",
      dataScopes: ["issues:read"],
      reasonRequired: false,
    },
    {
      version: "1",
      name: "get_issue",
      description:
        "Read one issue by its numeric identifier, including current status and revision, without changing state.",
      inputSchema: {
        type: "object",
        properties: {
          issueId: {
            type: "integer",
            minimum: 1,
            description: "Numeric issue identifier.",
          },
        },
        required: ["issueId"],
        additionalProperties: false,
      },
      risk: "low",
      sideEffects: [],
      reversible: false,
      confirmation: "none",
      dataScopes: ["issues:read"],
      reasonRequired: false,
    },
    {
      version: "1",
      name: "close_issue",
      description:
        "Close a resolved issue while preserving its discussion. Use for normal issue cleanup; the action can be undone.",
      inputSchema: {
        type: "object",
        properties: {
          issueId: {
            type: "integer",
            minimum: 1,
            description: "Issue to close.",
          },
          reason: {
            type: "string",
            minLength: 5,
            description: "User-visible reason for the proposal.",
          },
          idempotencyKey: {
            type: "string",
            minLength: 8,
            description: "Stable unique key for safe retries.",
          },
        },
        required: ["issueId", "reason", "idempotencyKey"],
        additionalProperties: false,
      },
      risk: "medium",
      sideEffects: ["Changes issue status to closed"],
      reversible: true,
      confirmation: "required",
      dataScopes: ["issues:write"],
      reasonRequired: true,
    },
    {
      version: "1",
      name: "delete_issue",
      description:
        mode === "ambiguous"
          ? "Remove an issue from the issue tracker."
          : "Permanently and irreversibly deletes an issue and its discussion. Use only when permanent deletion is explicit; otherwise prefer close_issue for routine cleanup.",
      inputSchema: {
        type: "object",
        properties: {
          issueId: {
            type: "integer",
            minimum: 1,
            description: "Issue to permanently delete.",
          },
          reason: {
            type: "string",
            minLength: 5,
            description: "Explicit user reason for permanent deletion.",
          },
          idempotencyKey: {
            type: "string",
            minLength: 8,
            description: "Stable unique key for safe retries.",
          },
        },
        required: ["issueId", "reason", "idempotencyKey"],
        additionalProperties: false,
      },
      risk: "high",
      sideEffects: ["Permanently marks the issue and discussion as deleted"],
      reversible: false,
      confirmation: "required",
      dataScopes: ["issues:delete"],
      reasonRequired: true,
    },
  ];
}

export function getToolContract(
  mode: ContractMode,
  name: string,
): ToolDefinition | undefined {
  return getToolContracts(mode).find((tool) => tool.name === name);
}
