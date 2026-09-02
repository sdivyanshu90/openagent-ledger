import type {
  Activity,
  Issue,
  LedgerEntry,
  Run,
  Scenario,
  ToolDefinition,
} from "../domain/schemas";

export interface Snapshot {
  contractMode: "ambiguous" | "improved";
  tools: ToolDefinition[];
  issues: Issue[];
  scenarios: Scenario[];
  runs: Run[];
  ledger: LedgerEntry[];
  activities: Activity[];
}

export interface CapabilityProposal {
  tool: "close_issue" | "delete_issue";
  action: LedgerEntry;
  idempotent: boolean;
}

export interface IntegrityReport {
  valid: boolean;
  checkedEntries: number;
  checkedTransitions: number;
  fixture?: boolean;
  broken?: {
    entryId: string;
    transitionIndex?: number;
    reason: string;
    expected: string;
    actual: string;
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok)
    throw new Error(body.message ?? `Request failed (${response.status})`);
  return body;
}

export const api = {
  snapshot: () => request<Snapshot>("/api/snapshot"),
  run: (scenarioId: string) =>
    request<{ run: Run; action: LedgerEntry }>(
      `/api/scenarios/${scenarioId}/runs`,
      { method: "POST", body: "{}" },
    ),
  approve: (id: string, acknowledgement?: string) =>
    request(`/api/actions/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ acknowledgement }),
    }),
  reject: (id: string) =>
    request(`/api/actions/${id}/reject`, { method: "POST", body: "{}" }),
  undo: (id: string) =>
    request(`/api/actions/${id}/undo`, { method: "POST", body: "{}" }),
  contract: (mode: Snapshot["contractMode"]) =>
    request("/api/contracts/mode", {
      method: "PUT",
      body: JSON.stringify({ mode }),
    }),
  reset: () => request("/api/demo/reset", { method: "POST", body: "{}" }),
  compare: (scenarioId: string) =>
    request<{
      baselineScore: number;
      currentScore: number;
      delta: number;
      result: string;
    }>(`/api/scenarios/${scenarioId}/compare`),
  integrity: (fixture = false) =>
    request<IntegrityReport>(
      `/api/ledger/integrity${fixture ? "?fixture=broken" : ""}`,
    ),
  createScenario: (scenario: Scenario) =>
    request<Scenario>("/api/scenarios", {
      method: "POST",
      body: JSON.stringify(scenario),
    }),
  invoke: <T = unknown>(
    tool: string,
    input: Record<string, unknown>,
    source: "webmcp" | "workbench" = "webmcp",
  ) =>
    request<T>(`/api/capabilities/${tool}/invoke`, {
      method: "POST",
      body: JSON.stringify({ source, input }),
    }),
};
