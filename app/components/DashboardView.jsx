"use client";

import {
  Check,
  Clipboard,
  Eye,
  FileText,
  GitCommitHorizontal,
  GitPullRequest,
  Layers3,
  Sparkles,
  Trash2,
} from "lucide-react";

const styleLabels = {
  standup: "Standup",
  concise: "Concise",
  detailed: "Detailed",
  "sheet-cell": "Sheet cell",
  "time-wise": "Time-wise",
  "bullet-points": "Bullet points",
};

export function DashboardView({
  activity,
  commitCount,
  error,
  githubAuthor,
  history,
  loading,
  onCopy,
  onDeleteHistory,
  onGenerate,
  onInspect,
  onOpenSettings,
  onRestoreHistory,
  onWorkDateChange,
  pullRequestCount,
  selectedRepos,
  setupComplete,
  sheetStatus,
  showActivity,
  style,
  summary,
  workDate,
}) {
  const busy = loading === "activity" || loading === "summary";

  return (
    <>
      <PageHeader
        eyebrow="Dashboard / Daily worklog"
        title="Daily worklog"
        subtitle="Turn selected GitHub activity into a clean office-ready update."
        badge={githubAuthor || "Commit author not selected"}
      />

      <div className="page-scroll">
        <div className="dashboard">
          <section className="metric-grid" aria-label="Worklog statistics">
            <Metric label="Monitored repos" value={selectedRepos.length} icon={Layers3} />
            <Metric label="Commits selected date" value={commitCount} icon={GitCommitHorizontal} />
            <Metric label="Pull requests" value={pullRequestCount} icon={GitPullRequest} />
            <Metric label="Summaries saved" value={history.length} icon={FileText} />
          </section>

          {!setupComplete && (
            <section className="setup-banner">
              <div>
                <strong>Finish setup before generating</strong>
                <p>Add GitHub, Gemini, an author, and at least one repository.</p>
              </div>
              <button className="secondary-button" type="button" onClick={onOpenSettings}>
                Open Settings
              </button>
            </section>
          )}

          <section className="control-panel">
            <Field label="Date">
              <input
                type="date"
                value={workDate}
                disabled={busy}
                onChange={(event) => onWorkDateChange(event.target.value)}
              />
            </Field>
            <div className="scope-field">
              <span className="field-label">Scope</span>
              <div className="scope-value">
                <Layers3 size={15} />
                <span>{selectedRepos.length} {selectedRepos.length === 1 ? "repo" : "repos"} selected</span>
              </div>
            </div>
            <button
              className="primary-action"
              disabled={!setupComplete || busy}
              type="button"
              onClick={onGenerate}
            >
              {busy && <span className="spinner dark" />}
              {!busy && <Sparkles size={16} />}
              {loading === "summary" ? "Generating" : loading === "activity" ? "Fetching" : "Generate Worklog"}
            </button>
            <button
              className="secondary-button inspect-button"
              disabled={!setupComplete || busy}
              type="button"
              onClick={onInspect}
            >
              <Eye size={16} />
              Inspect Activity
            </button>
          </section>

          {error && <div className="error-banner" role="alert">{error}</div>}

          <div className="content-grid">
            <section className="panel summary-panel">
              <PanelHeader
                eyebrow="Daily log"
                title="Generated summary"
                badge={styleLabels[style] || style}
              />
              <div className="panel-body summary-body">
                {loading === "summary" && <SummaryLoading />}
                {!summary && loading !== "summary" && (
                  <div className="empty-state">
                    <FileText size={22} />
                    <strong>No summary yet</strong>
                    <span>Generate a worklog for the selected date.</span>
                  </div>
                )}
                {summary && loading !== "summary" && (
                  <pre className="summary-text">{summary}</pre>
                )}

                {(summary || sheetStatus) && (
                  <div className="summary-footer">
                    {sheetStatus && (
                      <span className={`sheet-badge ${/updated|added/i.test(sheetStatus) ? "success" : ""}`}>
                        {/updated|added/i.test(sheetStatus) && <Check size={14} />}
                        {sheetStatus}
                      </span>
                    )}
                    {summary && (
                      <button className="compact-button" type="button" onClick={onCopy}>
                        <Clipboard size={14} />
                        Copy
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>

            <aside className="side-stack">
              <section className="panel activity-stats">
                <p className="panel-eyebrow">Selected date activity</p>
                <StatLine label="Commits" value={commitCount} />
                <StatLine label="Pull requests" value={pullRequestCount} />
                <StatLine label="Repositories" value={selectedRepos.length} />
              </section>

              <section className="panel history-panel">
                <PanelHeader eyebrow="Saved" title="Summary history" />
                {!history.length && (
                  <div className="empty-history">No summaries yet. Generate your first worklog.</div>
                )}
                <div className="history-list">
                  {history.map((entry) => (
                    <article className="history-row" key={entry.id}>
                      <button
                        className="history-restore"
                        disabled={busy}
                        type="button"
                        onClick={() => onRestoreHistory(entry)}
                      >
                        <strong>{entry.workDate}</strong>
                        <span>{entry.repos?.join(", ") || styleLabels[entry.style] || entry.style}</span>
                      </button>
                      <button
                        className="icon-button danger"
                        aria-label={`Delete summary for ${entry.workDate}`}
                        title="Delete"
                        type="button"
                        disabled={busy}
                        onClick={() => onDeleteHistory(entry.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            </aside>
          </div>

          {showActivity && (
            <section className="panel inspected-activity">
              <PanelHeader eyebrow="Source" title="GitHub activity" />
              <pre>{activity || "No activity loaded."}</pre>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

export function PageHeader({ badge, eyebrow, subtitle, title }) {
  return (
    <header className="page-header">
      <div>
        <p className="page-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      {badge && <span className="author-badge"><span className="status-dot connected" />{badge}</span>}
    </header>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <article className="metric-card">
      <div className="metric-label"><span>{label}</span><Icon size={16} /></div>
      <strong>{value}</strong>
    </article>
  );
}

function Field({ children, label }) {
  return <label className="field"><span className="field-label">{label}</span>{children}</label>;
}

function PanelHeader({ badge, eyebrow, title }) {
  return (
    <header className="panel-header">
      <div><p className="panel-eyebrow">{eyebrow}</p><h2>{title}</h2></div>
      {badge && <span className="pill">{badge}</span>}
    </header>
  );
}

function StatLine({ label, value }) {
  return <div className="stat-line"><span>{label}</span><strong>{value}</strong></div>;
}

function SummaryLoading() {
  return (
    <div className="summary-loading">
      <div className="loading-label"><span className="spinner" />Analyzing commits and PRs with Gemini...</div>
      <i /><i /><i /><i />
    </div>
  );
}
