import type { LedgerEntry, ToolDefinition } from "../domain/schemas";
import { api, type CapabilityProposal } from "./api";

type WebMcpTool = {
  name: string;
  description: string;
  inputSchema: ToolDefinition["inputSchema"];
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

declare global {
  interface Document {
    modelContext?: {
      registerTool(
        tool: WebMcpTool,
        options?: { signal?: AbortSignal },
      ): void | Promise<void>;
    };
  }
}

export interface WebMcpBridgeCallbacks {
  onAction?: (proposal: { action: LedgerEntry; token: string }) => void;
  onActivity?: () => void;
  onStatus?: (status: {
    supported: boolean;
    registered: number;
    names: string[];
  }) => void;
  onError?: (message: string) => void;
}

const siteToolNames = new Set([
  "search_issues",
  "get_issue",
  "close_issue",
  "delete_issue",
]);

export function registerWebMcpTools(
  callbacks: WebMcpBridgeCallbacks = {},
): () => void {
  const context = document.modelContext;
  if (typeof context?.registerTool !== "function") {
    callbacks.onStatus?.({ supported: false, registered: 0, names: [] });
    return () => undefined;
  }

  const controller = new AbortController();
  void api
    .snapshot()
    .then(async (snapshot) => {
      const definitions = snapshot.tools.filter(({ name }) =>
        siteToolNames.has(name),
      );
      for (const definition of definitions) {
        if (controller.signal.aborted) return;
        await context.registerTool(toWebMcpTool(definition, callbacks), {
          signal: controller.signal,
        });
      }
      callbacks.onStatus?.({
        supported: true,
        registered: definitions.length,
        names: definitions.map(({ name }) => name),
      });
    })
    .catch((error: unknown) =>
      callbacks.onError?.(
        error instanceof Error
          ? error.message
          : "Site tool registration failed.",
      ),
    );

  return () => controller.abort();
}

function toWebMcpTool(
  definition: ToolDefinition,
  callbacks: WebMcpBridgeCallbacks,
): WebMcpTool {
  const readOnly =
    definition.name === "search_issues" || definition.name === "get_issue";
  return {
    name: definition.name,
    description: `${definition.description} Risk: ${definition.risk}. Side effects: ${definition.sideEffects.join("; ") || "none"}. Confirmation: ${definition.confirmation}.`,
    inputSchema: definition.inputSchema,
    annotations: readOnly ? { readOnlyHint: true } : undefined,
    execute: async (input) => {
      if (readOnly) {
        const result = await api.invoke(definition.name, input);
        callbacks.onActivity?.();
        return result;
      }

      const proposal = await api.invoke<CapabilityProposal>(
        definition.name,
        input,
      );
      callbacks.onActivity?.();
      if (proposal.approvalToken) {
        callbacks.onAction?.({
          action: proposal.action,
          token: proposal.approvalToken,
        });
      }
      return publicProposal(proposal);
    },
  };
}

function publicProposal(proposal: CapabilityProposal) {
  return {
    status: "awaiting_human_confirmation",
    actionId: proposal.action.id,
    tool: proposal.tool,
    risk: proposal.action.risk,
    reversible: proposal.action.reversible,
    sideEffects: proposal.action.sideEffects,
    preview: proposal.action.preview,
    message:
      "The action was proposed but has not executed. The human must review it in the Action Ledger.",
  };
}
