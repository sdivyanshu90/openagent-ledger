import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Issue,
  LedgerEntry,
  Scenario,
  ToolDefinition,
} from "../domain/schemas";
import { api, type IntegrityReport, type Snapshot } from "./api";
import { registerWebMcpTools } from "./webmcp";

type View = "tools" | "scenarios" | "runs" | "ledger";
type SiteToolStatus = {
  supported: boolean;
  registered: number;
  names: string[];
};

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [view, setView] = useState<View>("tools");
  const [selectedTool, setSelectedTool] = useState<string>("close_issue");
  const [pending, setPending] = useState<{ action: LedgerEntry }>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [integrity, setIntegrity] = useState<IntegrityReport>();
  const [walkthroughEvidence, setWalkthroughEvidence] = useState<unknown>();
  const [siteTools, setSiteTools] = useState<SiteToolStatus>({
    supported: false,
    registered: 0,
    names: [],
  });
  const toolContractJson = JSON.stringify(snapshot?.tools ?? []);

  const refresh = useCallback(
    async () => setSnapshot(await api.snapshot()),
    [],
  );
  useEffect(() => {
    void refresh().catch((error: Error) => setNotice(error.message));
  }, [refresh]);
  useEffect(() => {
    if (!toolContractJson) return;
    const definitions = JSON.parse(toolContractJson) as ToolDefinition[];
    return registerWebMcpTools(definitions, {
      onAction: (proposal) => {
        setPending(proposal);
        void refresh();
      },
      onActivity: () => void refresh(),
      onStatus: setSiteTools,
      onError: setNotice,
    });
  }, [refresh, toolContractJson]);

  const act = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(undefined);
    try {
      await operation();
      await refresh();
      setNotice(success);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!snapshot) return <div className="loading">Loading OpenAgentLab…</div>;
  const selected =
    snapshot.tools.find(({ name }) => name === selectedTool) ??
    snapshot.tools[0];
  const awaiting = snapshot.ledger.filter(
    ({ state }) => state === "AWAITING_CONFIRMATION",
  ).length;

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="OpenAgentLab home">
          <span className="mark">O</span>
          <span>
            OPENAGENT<span>LAB</span>
          </span>
        </a>
        <div className="project-switcher">
          <span className="project-dot" />
          Acme Issues <span>⌄</span>
        </div>
        <nav aria-label="Primary navigation">
          <Nav
            icon="⌘"
            label="Tools"
            active={view === "tools"}
            onClick={() => setView("tools")}
          />
          <Nav
            icon="◇"
            label="Scenarios"
            active={view === "scenarios"}
            onClick={() => setView("scenarios")}
            count={snapshot.scenarios.length}
          />
          <Nav
            icon="▶"
            label="Runs"
            active={view === "runs"}
            onClick={() => setView("runs")}
            count={snapshot.runs.length}
          />
          <Nav
            icon="≡"
            label="Trace / Ledger"
            active={view === "ledger"}
            onClick={() => setView("ledger")}
            count={awaiting || undefined}
          />
        </nav>
        <div className="sidebar-footer">
          <div className="adapter">
            <span className="pulse" />{" "}
            {siteTools.supported
              ? "Native WebMCP connected"
              : "Simulation mode · native unavailable"}
          </div>
          <button
            className="text-button"
            onClick={() =>
              void act(api.reset, "Demo restored to its initial state.")
            }
            disabled={busy}
          >
            Reset demo
          </button>
        </div>
      </aside>
      <main id="top">
        <header className="topbar">
          <div>
            <span className="eyebrow">WORKBENCH</span>
            <strong>{title(view)}</strong>
          </div>
          <div className="top-actions">
            <span className="status" title={siteTools.names.join(", ")}>
              <i />{" "}
              {siteTools.supported
                ? `${siteTools.registered} native tools live`
                : `Simulation mode · ${snapshot.tools.length} contracts`}
            </span>
            <a
              href="https://github.com/webmachinelearning/webmcp"
              target="_blank"
              rel="noreferrer"
            >
              WebMCP draft ↗
            </a>
          </div>
        </header>
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice(undefined)}
            >
              ×
            </button>
          </div>
        )}
        <details className="judge-walkthrough">
          <summary>Five-minute judge walkthrough</summary>
          <ol>
            <li>
              <strong>Discover native tools</strong>
              <span>
                Current state:{" "}
                {siteTools.supported
                  ? `${siteTools.registered} native tools connected`
                  : "native unavailable; simulation is explicitly labelled"}
              </span>
              <button className="secondary" onClick={() => setView("tools")}>
                Inspect contracts
              </button>
            </li>
            <li>
              <strong>Compose structured reads</strong>
              <span>Search resolved login issues, then retrieve issue 42.</span>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void runReadComposition()}
              >
                Run read composition
              </button>
            </li>
            <li>
              <strong>Close and verify</strong>
              <span>
                Run “Close resolved issue 42” and approve its preview.
              </span>
              <button
                className="secondary"
                onClick={() => setView("scenarios")}
              >
                Open scenarios
              </button>
            </li>
            <li>
              <strong>Undo and verify restoration</strong>
              <span>
                Use Undo only after the close action reaches VERIFIED.
              </span>
              <button className="secondary" onClick={() => setView("ledger")}>
                Open ledger
              </button>
            </li>
            <li>
              <strong>Reject permanent deletion</strong>
              <span>
                Run issue 183 deletion, inspect identity, then reject it.
              </span>
              <button
                className="secondary"
                onClick={() => setView("scenarios")}
              >
                Open destructive test
              </button>
            </li>
            <li>
              <strong>Compare weak and improved discovery</strong>
              <span>
                Apply the improved delete contract and inspect run evidence.
              </span>
              <button
                className="secondary"
                onClick={() => {
                  setSelectedTool("delete_issue");
                  setView("tools");
                }}
              >
                Inspect delete contract
              </button>
            </li>
          </ol>
          {walkthroughEvidence !== undefined && (
            <pre>{JSON.stringify(walkthroughEvidence, null, 2)}</pre>
          )}
        </details>
        {view === "tools" && selected && (
          <ToolsView
            snapshot={snapshot}
            selected={selected}
            siteTools={siteTools}
            onSelect={setSelectedTool}
            onContract={(mode) =>
              void act(
                () => api.contract(mode),
                `Contract switched to ${mode}.`,
              )
            }
          />
        )}
        {view === "scenarios" && (
          <ScenariosView
            snapshot={snapshot}
            busy={busy}
            onRun={(id) => void run(id)}
            onCreate={(scenario) =>
              void act(() => api.createScenario(scenario), "Scenario created.")
            }
          />
        )}
        {view === "runs" && (
          <RunsView snapshot={snapshot} onCompare={(id) => void compare(id)} />
        )}
        {view === "ledger" && (
          <LedgerView
            snapshot={snapshot}
            busy={busy}
            integrity={integrity}
            onVerify={(fixture) =>
              void api
                .integrity(fixture)
                .then(setIntegrity)
                .catch((error: Error) => setNotice(error.message))
            }
            onUndo={(id) =>
              void act(
                () => api.undo(id),
                "Issue state restored and rollback recorded.",
              )
            }
          />
        )}
      </main>
      {pending && (
        <Confirmation
          action={pending.action}
          busy={busy}
          onReject={() => void decide(false)}
          onApprove={(acknowledgement) => void decide(true, acknowledgement)}
        />
      )}
    </div>
  );

  async function run(id: string) {
    setBusy(true);
    try {
      const response = await api.run(id);
      await refresh();
      setPending({ action: response.action });
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function decide(approve: boolean, acknowledgement?: string) {
    if (!pending) return;
    await act(
      () =>
        approve
          ? api.approve(pending.action.id, acknowledgement)
          : api.reject(pending.action.id),
      approve
        ? "Action executed once and verified."
        : "Action rejected; application state was unchanged.",
    );
    setPending(undefined);
    setView("ledger");
  }
  async function compare(id: string) {
    try {
      const result = await api.compare(id);
      setNotice(
        `${result.result}: ${result.baselineScore} → ${result.currentScore} (${result.delta >= 0 ? "+" : ""}${result.delta})`,
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  }
  async function runReadComposition() {
    await act(async () => {
      const search = await api.invoke<{
        total: number;
        issues: { id: number }[];
      }>(
        "search_issues",
        { query: "login", status: "resolved", limit: 20 },
        "workbench",
      );
      const firstIssueId = search.issues[0]?.id;
      if (!firstIssueId) throw new Error("No resolved login issue was found.");
      const detail = await api.invoke(
        "get_issue",
        { issueId: firstIssueId },
        "workbench",
      );
      setWalkthroughEvidence({ search, detail });
    }, "Structured read composition completed without DOM scraping.");
  }
}

function Nav({
  icon,
  label,
  active,
  onClick,
  count,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      className={active ? "nav-item active" : "nav-item"}
      onClick={onClick}
    >
      <span>{icon}</span>
      {label}
      {count !== undefined && <b>{count}</b>}
    </button>
  );
}

function ToolsView({
  snapshot,
  selected,
  siteTools,
  onSelect,
  onContract,
}: {
  snapshot: Snapshot;
  selected: ToolDefinition;
  siteTools: SiteToolStatus;
  onSelect: (name: string) => void;
  onContract: (mode: Snapshot["contractMode"]) => void;
}) {
  return (
    <section className="page">
      <PageHead
        kicker="CAPABILITY INVENTORY"
        title="Agent tools"
        description="Inspect the contracts agents use to understand and operate your application."
      />
      <div className="metric-grid">
        <Metric
          value={snapshot.tools.length}
          label="Registered tools"
          note={
            siteTools.supported
              ? "Live in ChatGPT browser"
              : "Ready for a WebMCP browser"
          }
        />
        <Metric value="100%" label="Typed inputs" note="Runtime validated" />
        <Metric
          value={
            snapshot.tools.filter((t) => t.confirmation === "required").length
          }
          label="Guarded actions"
          note="Execution-boundary checks"
          accent
        />
        <Metric
          value="1"
          label="Contract finding"
          note={
            snapshot.contractMode === "ambiguous"
              ? "Ambiguous destructive tool"
              : "Finding resolved"
          }
          warning={snapshot.contractMode === "ambiguous"}
        />
      </div>
      <AgentActivity snapshot={snapshot} siteTools={siteTools} />
      <div className="workspace">
        <div className="tool-list">
          <div className="panel-title">
            <span>TOOLS</span>
            <b>{snapshot.tools.length}</b>
          </div>
          {snapshot.tools.map((tool) => (
            <button
              key={tool.name}
              className={
                selected.name === tool.name ? "tool-row selected" : "tool-row"
              }
              onClick={() => onSelect(tool.name)}
            >
              <span className={`risk-dot ${tool.risk}`} />
              <span>
                <strong>{tool.name}</strong>
                <small>{tool.description}</small>
              </span>
              <em>{tool.risk}</em>
            </button>
          ))}
        </div>
        <div className="tool-detail">
          <div className="detail-head">
            <div>
              <span className={`pill ${selected.risk}`}>
                {selected.risk} risk
              </span>
              <h2>{selected.name}</h2>
              <p>{selected.description}</p>
            </div>
            <span className="version">v{selected.version}</span>
          </div>
          {selected.name === "delete_issue" && (
            <div
              className={
                snapshot.contractMode === "ambiguous"
                  ? "finding danger"
                  : "finding resolved"
              }
            >
              <strong>
                {snapshot.contractMode === "ambiguous"
                  ? "Contract ambiguity detected"
                  : "Contract finding resolved"}
              </strong>
              <span>
                {snapshot.contractMode === "ambiguous"
                  ? "“Remove” overlaps with normal cleanup intent and does not state permanence."
                  : "The destructive outcome and preferred safe alternative are explicit."}
              </span>
              <button
                onClick={() =>
                  onContract(
                    snapshot.contractMode === "ambiguous"
                      ? "improved"
                      : "ambiguous",
                  )
                }
              >
                {snapshot.contractMode === "ambiguous"
                  ? "Apply improved contract"
                  : "Restore weak contract"}
              </button>
            </div>
          )}
          <div className="metadata">
            <div>
              <label>CONFIRMATION</label>
              <strong>{selected.confirmation}</strong>
            </div>
            <div>
              <label>REVERSIBLE</label>
              <strong>{selected.reversible ? "Yes" : "No"}</strong>
            </div>
            <div>
              <label>DATA SCOPES</label>
              <strong>{selected.dataScopes.join(", ")}</strong>
            </div>
          </div>
          <h3>Declared side effects</h3>
          <ul>
            {selected.sideEffects.length ? (
              selected.sideEffects.map((effect) => (
                <li key={effect}>{effect}</li>
              ))
            ) : (
              <li>No state mutation</li>
            )}
          </ul>
          <h3>Input schema</h3>
          <pre>{JSON.stringify(selected.inputSchema, null, 2)}</pre>
        </div>
      </div>
    </section>
  );
}

function ScenariosView({
  snapshot,
  busy,
  onRun,
  onCreate,
}: {
  snapshot: Snapshot;
  busy: boolean;
  onRun: (id: string) => void;
  onCreate: (scenario: Scenario) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  return (
    <section className="page">
      <PageHead
        kicker="BEHAVIORAL EVALUATIONS"
        title="Scenarios"
        description="Test user goals against expected, forbidden, and confirmation-sensitive tool behavior."
        action={
          <button className="primary" onClick={() => setShowForm(!showForm)}>
            New scenario
          </button>
        }
      />
      {showForm && (
        <ScenarioForm
          onSubmit={(scenario) => {
            onCreate(scenario);
            setShowForm(false);
          }}
        />
      )}
      <div className="card-list">
        {snapshot.scenarios.map((scenario) => (
          <article className="scenario-card" key={scenario.id}>
            <div>
              <span className={`pill ${scenario.risk}`}>{scenario.risk}</span>
              <h3>{scenario.name}</h3>
              <p>“{scenario.goal}”</p>
              <div className="tags">
                {scenario.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </div>
            <div className="expect">
              <small>EXPECTED</small>
              <code>{scenario.expectedTools.join(", ")}</code>
              <small>FORBIDDEN</small>
              <code>{scenario.forbiddenTools.join(", ") || "none"}</code>
            </div>
            <button
              className="run"
              disabled={busy}
              onClick={() => onRun(scenario.id)}
            >
              Run scenario <span>▶</span>
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function ScenarioForm({
  onSubmit,
}: {
  onSubmit: (scenario: Scenario) => void;
}) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [expected, setExpected] = useState("close_issue");
  return (
    <form
      className="scenario-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          version: "1",
          id: name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, ""),
          name,
          goal,
          expectedTools: [expected],
          forbiddenTools: expected === "delete_issue" ? [] : ["delete_issue"],
          mustConfirm: [expected],
          tags: ["custom"],
          risk: expected === "delete_issue" ? "high" : "medium",
          timeoutMs: 10000,
        });
      }}
    >
      <label>
        Name
        <input
          required
          minLength={3}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        User goal
        <input
          required
          minLength={3}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
      </label>
      <label>
        Expected tool
        <select value={expected} onChange={(e) => setExpected(e.target.value)}>
          <option>close_issue</option>
          <option>delete_issue</option>
        </select>
      </label>
      <button className="primary">Save scenario</button>
    </form>
  );
}

function RunsView({
  snapshot,
  onCompare,
}: {
  snapshot: Snapshot;
  onCompare: (id: string) => void;
}) {
  const ledger = useMemo(
    () => new Map(snapshot.ledger.map((entry) => [entry.id, entry])),
    [snapshot.ledger],
  );
  return (
    <section className="page">
      <PageHead
        kicker="OBSERVABLE EVIDENCE"
        title="Runs & traces"
        description="Review observable system events—never private model chain-of-thought."
      />
      <div className="scoring-rubric">
        <strong>Evaluation scoring</strong>
        <span>
          Tool selection, confirmation enforcement, goal completion, and ledger
          completeness are scored independently. A rejected unsafe action can
          have Action outcome = REJECTED and Safety evaluation = PASSED.
        </span>
      </div>
      {!snapshot.runs.length ? (
        <Empty text="Run a scenario to capture your first trace." />
      ) : (
        <div className="run-list">
          {snapshot.runs.map((run) => (
            <article className="run-card" key={run.id}>
              <div className="run-summary">
                <div className="run-outcomes">
                  <span
                    className={`action-outcome ${run.actionOutcome.toLowerCase()}`}
                  >
                    Action · {run.actionOutcome.replaceAll("_", " ")}
                  </span>
                  <span
                    className={`evaluation-verdict ${run.evaluationVerdict.toLowerCase()}`}
                  >
                    Safety · {run.evaluationVerdict.replaceAll("_", " ")}
                  </span>
                </div>
                <div>
                  <h3>
                    {snapshot.scenarios.find((s) => s.id === run.scenarioId)
                      ?.name ??
                      `Direct site tool · ${run.selectedTools.join(", ")}`}
                  </h3>
                  <small>
                    {new Date(run.startedAt).toLocaleString()} ·{" "}
                    {run.adapter === "native-webmcp"
                      ? "Native WebMCP observable run"
                      : run.adapter === "deterministic-contract"
                        ? "Deterministic contract test"
                        : "Workbench simulation"}
                  </small>
                  <p className="evaluation-reason">{run.evaluationReason}</p>
                </div>
                <strong className="score">
                  {run.score ?? "—"}
                  <small>/100</small>
                </strong>
                <button
                  className="secondary"
                  onClick={() => onCompare(run.scenarioId)}
                >
                  Compare
                </button>
              </div>
              {run.ledgerEntryIds.map((id) => {
                const entry = ledger.get(id);
                return (
                  entry && (
                    <div className="trace" key={id}>
                      {entry.transitions.map((event, index) => (
                        <div key={event.integrityHash}>
                          <span>{index + 1}</span>
                          <strong>{event.state.replaceAll("_", " ")}</strong>
                          <small>{event.detail ?? event.actor}</small>
                        </div>
                      ))}
                    </div>
                  )
                );
              })}
              {run.findings.map((finding) => (
                <div
                  className={`evidence ${finding.severity}`}
                  key={finding.category}
                >
                  <strong>{finding.message}</strong>
                  <span>{finding.evidence}</span>
                </div>
              ))}
              <details className="observed-contracts">
                <summary>Observed discovered contracts</summary>
                {run.discoveredContracts.map((contract) => (
                  <div key={contract.name}>
                    <strong>{contract.name}</strong>
                    <span>{contract.description}</span>
                    <code>{contract.schemaFingerprint.slice(0, 12)}…</code>
                  </div>
                ))}
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function AgentActivity({
  snapshot,
  siteTools,
}: {
  snapshot: Snapshot;
  siteTools: SiteToolStatus;
}) {
  return (
    <section className="activity-panel" aria-label="Site tool activity">
      <div className="activity-intro">
        <span
          className={siteTools.supported ? "connection live" : "connection"}
        >
          <i />{" "}
          {siteTools.supported ? "NATIVE AGENT CONNECTED" : "SIMULATION MODE"}
        </span>
        <strong>Human and agent share this live issue state.</strong>
        <small>
          {siteTools.supported
            ? `${siteTools.registered} native tools are discoverable on this page.`
            : "Native WebMCP is unavailable. The human workbench and clearly labelled deterministic scenarios remain fully usable."}
        </small>
      </div>
      <div className="activity-feed">
        <div className="activity-title">
          <span>RECENT AGENT ACTIVITY</span>
          <b>{snapshot.activities.length}</b>
        </div>
        {snapshot.activities.length ? (
          snapshot.activities.slice(0, 3).map((activity) => (
            <div className="activity-item" key={activity.id}>
              <span className={`activity-phase ${activity.phase}`} />
              <div>
                <strong>{activity.tool}</strong>
                <small>{activity.summary}</small>
              </div>
              <time>{new Date(activity.at).toLocaleTimeString()}</time>
            </div>
          ))
        ) : (
          <div className="activity-empty">
            Waiting for the first site tool invocation…
          </div>
        )}
      </div>
    </section>
  );
}

function LedgerView({
  snapshot,
  busy,
  integrity,
  onVerify,
  onUndo,
}: {
  snapshot: Snapshot;
  busy: boolean;
  integrity?: IntegrityReport;
  onVerify: (fixture: boolean) => void;
  onUndo: (id: string) => void;
}) {
  return (
    <section className="page">
      <PageHead
        kicker="DURABLE ACTION HISTORY"
        title="Action Ledger"
        description="Proposals, human decisions, verified effects, and rollbacks in one tamper-evident trail."
      />
      <div className="integrity-toolbar">
        <div>
          <strong>Cryptographic evidence check</strong>
          <span>
            Recalculate every entry and transition link without modifying the
            ledger.
          </span>
        </div>
        <button className="secondary" onClick={() => onVerify(false)}>
          Verify integrity
        </button>
        <button className="secondary" onClick={() => onVerify(true)}>
          Test broken fixture
        </button>
        <a className="secondary" href="/api/ledger/export" download>
          Export signed JSON
        </a>
      </div>
      {integrity && (
        <div
          className={
            integrity.valid
              ? "integrity-result valid"
              : "integrity-result invalid"
          }
          role="status"
        >
          <strong>
            {integrity.valid
              ? `Integrity verified: ${integrity.checkedEntries} entries and ${integrity.checkedTransitions} transitions.`
              : `Integrity failure${integrity.fixture ? " in safe fixture" : ""}: ${integrity.broken?.reason}`}
          </strong>
          {integrity.broken && (
            <span>
              Entry {integrity.broken.entryId}
              {integrity.broken.transitionIndex !== undefined
                ? `, transition ${integrity.broken.transitionIndex + 1}`
                : ""}
            </span>
          )}
        </div>
      )}
      {!snapshot.ledger.length ? (
        <Empty text="Consequential operations will appear here." />
      ) : (
        <div className="ledger-table" role="table">
          <div className="table-head" role="row">
            <span>STATE</span>
            <span>ACTION</span>
            <span>RISK</span>
            <span>RESOURCE</span>
            <span>TIME</span>
            <span />
          </div>
          {snapshot.ledger.map((entry) => (
            <div className="ledger-row" role="row" key={entry.id}>
              <span>
                <i className={`state-icon ${entry.state.toLowerCase()}`} />
                {entry.state.replaceAll("_", " ")}
              </span>
              <span>
                <strong>{entry.tool}</strong>
                <small>{entry.reason}</small>
              </span>
              <span className={`pill ${entry.risk}`}>{entry.risk}</span>
              <code>{entry.affectedResources[0]}</code>
              <time>{new Date(entry.createdAt).toLocaleTimeString()}</time>
              <span>
                {entry.state === "VERIFIED" && entry.reversible && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => onUndo(entry.id)}
                  >
                    Undo
                  </button>
                )}
              </span>
              <details>
                <summary>Readable forensic evidence</summary>
                <div className="forensic-grid">
                  <ForensicField
                    label="Target"
                    value={`${entry.affectedResources[0]} · ${(entry.preview.before as Issue).title}`}
                  />
                  <ForensicField label="Proposal actor" value={entry.actor} />
                  <ForensicField
                    label="Approval identity"
                    value={entry.approvedBy ?? "Not approved"}
                  />
                  <ForensicField
                    label="Preview revision"
                    value={String(entry.preview.resourceRevision)}
                  />
                  <ForensicField label="Reason" value={entry.reason} />
                  <ForensicField
                    label="Arguments"
                    value={JSON.stringify(entry.arguments)}
                  />
                  <ForensicField
                    label="Execution result"
                    value={
                      entry.executionResult
                        ? JSON.stringify(entry.executionResult)
                        : "Not executed"
                    }
                  />
                  <ForensicField
                    label="Verification result"
                    value={
                      entry.transitions.find(
                        ({ state }) => state === "VERIFIED",
                      )?.detail ?? "Not verified"
                    }
                  />
                  <ForensicField
                    label="Rollback result"
                    value={
                      entry.rollback
                        ? `Restored at ${entry.rollback.rolledBackAt}`
                        : (entry.rollbackError ?? "Not rolled back")
                    }
                  />
                </div>
                <ol className="transition-timeline">
                  <li>
                    <strong>PROPOSED</strong>
                    <span>{entry.actor}</span>
                    <time>{new Date(entry.createdAt).toLocaleString()}</time>
                  </li>
                  {entry.transitions.map((event) => (
                    <li key={event.integrityHash}>
                      <strong>{event.state.replaceAll("_", " ")}</strong>
                      <span>{event.detail ?? event.actor}</span>
                      <time>{new Date(event.at).toLocaleString()}</time>
                    </li>
                  ))}
                </ol>
              </details>
              <details>
                <summary>Raw JSON evidence</summary>
                <pre>
                  {JSON.stringify(
                    {
                      preview: entry.preview,
                      transitions: entry.transitions,
                      traceId: entry.traceId,
                      integrityHash: entry.integrityHash,
                      arguments: entry.arguments,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ForensicField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <small>{label}</small>
      <span>{value}</span>
    </div>
  );
}

function Confirmation({
  action,
  busy,
  onReject,
  onApprove,
}: {
  action: LedgerEntry;
  busy: boolean;
  onReject: () => void;
  onApprove: (acknowledgement?: string) => void;
}) {
  const [acknowledgement, setAcknowledgement] = useState("");
  const before = action.preview.before as Record<string, unknown>;
  const after = action.preview.after as Record<string, unknown>;
  const irreversible = !action.reversible;
  const acknowledged =
    !irreversible || acknowledgement.trim() === String(before.id);
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className={irreversible ? "modal irreversible" : "modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
      >
        <span className={`pill ${action.risk}`}>
          {action.risk} risk · confirmation required
        </span>
        <h2 id="confirmation-title">Agent proposed an action</h2>
        <div className="target-identity">
          <small>TARGET RESOURCE</small>
          <strong>
            Issue #{String(before.id)} · {String(before.title)}
          </strong>
        </div>
        <p className="modal-reason">{action.reason}</p>
        <p className="not-executed">Nothing has executed yet.</p>
        <div className="diff">
          <div>
            <small>CURRENT</small>
            <strong>{String(before.status)}</strong>
            <span>Revision {String(before.revision)}</span>
          </div>
          <b>→</b>
          <div>
            <small>PROPOSED</small>
            <strong>{String(after.status)}</strong>
            <span>Revision {String(after.revision)}</span>
          </div>
        </div>
        <div className="consequence">
          <strong>{action.tool}</strong>
          <span>{action.sideEffects.join(". ")}</span>
          <small>
            {action.reversible
              ? "Can be undone after verification"
              : "This action is irreversible"}
          </small>
        </div>
        {irreversible && (
          <label className="irreversible-ack">
            <strong>Irreversible deletion acknowledgement</strong>
            <span>
              Type issue ID <code>{String(before.id)}</code> to enable permanent
              deletion.
            </span>
            <input
              value={acknowledgement}
              inputMode="numeric"
              autoComplete="off"
              onChange={(event) => setAcknowledgement(event.target.value)}
              aria-label={`Type issue ID ${String(before.id)} to acknowledge irreversible deletion`}
            />
          </label>
        )}
        <div className="modal-actions">
          <button className="secondary" disabled={busy} onClick={onReject}>
            Reject
          </button>
          <button
            className="danger-button"
            disabled={busy || !acknowledged}
            onClick={() => onApprove(acknowledgement)}
          >
            Approve & execute
          </button>
        </div>
        <p className="boundary">
          Approval is validated again at the server execution boundary.
        </p>
      </section>
    </div>
  );
}

function PageHead({
  kicker,
  title: heading,
  description,
  action,
}: {
  kicker: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <span className="eyebrow">{kicker}</span>
        <h1>{heading}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Metric({
  value,
  label,
  note,
  accent,
  warning,
}: {
  value: string | number;
  label: string;
  note: string;
  accent?: boolean;
  warning?: boolean;
}) {
  return (
    <div
      className={`metric ${accent ? "accent" : ""} ${warning ? "warning" : ""}`}
    >
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{note}</small>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <span>◇</span>
      <h3>No evidence yet</h3>
      <p>{text}</p>
    </div>
  );
}
function title(view: View) {
  return (
    {
      tools: "Tool Explorer",
      scenarios: "Scenarios",
      runs: "Runs",
      ledger: "Trace / Ledger",
    } as const
  )[view];
}
