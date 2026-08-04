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
  activitySource,
  commitCount,
  error,
  warning,
  githubAuthor,
  history,
  historyQuery,
  onHistoryQueryChange,
  loading,
  localRepositories,
  onCopy,
  onDeleteHistory,
  onGenerate,
  onInspect,
  onOpenSettings,
  onRestoreHistory,
  onSummaryChange,
  onSummaryCommit,
  onWriteSummary,
  rangeEnabled,
  rangeStart,
  rangeEnd,
  onRangeEnabledChange,
  onRangeStartChange,
  onRangeEndChange,
  rangeDrafts,
  onRangeDraftChange,
  onWriteRange,
  rangeWritePrompt,
  onConfirmRangeWrite,
  onCancelRangeWrite,
  onWorkDateChange,
  pullRequestCount,
  selectedRepos,
  setupComplete,
  sheetStatus,
  showActivity,
  style,
  summary,
  workDate,
  showHistory = false,
}) {
  const busy = loading === "activity" || loading === "summary" || loading === "range" || loading === "range-write";
  const monitoredCount = activitySource === "local"
    ? localRepositories.length
    : selectedRepos.length;

  return (
    <>
      <PageHeader
        eyebrow="Dashboard / Daily worklog"
        title="Daily worklog"
        subtitle={`Turn selected ${activitySource === "local" ? "local Git" : "GitHub"} activity into a clean office-ready update.`}
        badge={activitySource === "local" ? "Local commits" : githubAuthor || "Commit author not selected"}
      />

      <div className="page-scroll">
        <div className="dashboard">
          <section className="metric-grid" aria-label="Worklog statistics">
            <Metric label="Monitored repos" value={monitoredCount} icon={Layers3} />
            <Metric label="Commits selected date" value={commitCount} icon={GitCommitHorizontal} />
            <Metric label="Pull requests" value={pullRequestCount} icon={GitPullRequest} />
            <Metric label="Summaries saved" value={history.length} icon={FileText} />
          </section>

          {!setupComplete && (
            <section className="setup-banner">
              <div>
                <strong>Finish setup before generating</strong>
                <p>Add Gemini and finish the selected activity-source setup.</p>
              </div>
              <button className="secondary-button" type="button" onClick={onOpenSettings}>
                Open Settings
              </button>
            </section>
          )}

          <section className="control-panel">
            <label className="range-toggle"><input type="checkbox" checked={rangeEnabled} onChange={(event) => onRangeEnabledChange(event.target.checked)} /><span>Date range</span></label>
            {!rangeEnabled && <Field label="Date">
              <input
                type="date"
                value={workDate}
                disabled={busy}
                onChange={(event) => onWorkDateChange(event.target.value)}
              />
            </Field>}
            {rangeEnabled && <><Field label="From"><input type="date" value={rangeStart} disabled={busy} onChange={(event) => onRangeStartChange(event.target.value)} /></Field><Field label="To"><input type="date" value={rangeEnd} disabled={busy} onChange={(event) => onRangeEndChange(event.target.value)} /></Field></>}
            <div className="scope-field">
              <span className="field-label">Scope</span>
              <div className="scope-value">
                <Layers3 size={15} />
                <span>{monitoredCount} {monitoredCount === 1 ? "repo" : "repos"} selected</span>
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
              {loading === "range" ? "Generating range" : loading === "summary" ? "Generating" : loading === "activity" ? "Fetching" : rangeEnabled ? "Generate range" : "Generate Worklog"}
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
          {warning && <div className="warning-banner" role="status">{warning}</div>}

          {rangeEnabled && rangeDrafts.length > 0 && (
            <section className="panel range-review">
              <div className="panel-header"><div><p className="panel-eyebrow">Review</p><h2>Daily summaries</h2></div><button className="primary-action" disabled={busy} type="button" onClick={onWriteRange}>{loading === "range-write" ? "Writing" : "Write all to Sheet"}</button></div>
              <div className="range-draft-list">
                {rangeDrafts.map((draft) => <label className="range-draft" key={draft.date}><span><input type="checkbox" checked={draft.selected} onChange={(event) => onRangeDraftChange(draft.date, { selected: event.target.checked })} />{draft.date}<small>{draft.existing ? "Existing row" : "New row"}</small></span><textarea value={draft.summary} onChange={(event) => onRangeDraftChange(draft.date, { summary: event.target.value })} /></label>)}
              </div>
            </section>
          )}
          {rangeWritePrompt && <div className="write-prompt" role="dialog" aria-modal="true"><div className="write-prompt-card"><p className="panel-eyebrow">Confirm Sheet write</p><h2>Review selected dates</h2><p>{rangeWritePrompt.selected.length} selected: {rangeWritePrompt.selected.filter((draft) => !draft.existing).length} new, {rangeWritePrompt.existing.length} existing.</p>{rangeWritePrompt.existing.length > 0 && <small>Will replace: {rangeWritePrompt.existing.map((draft) => draft.date).join(", ")}</small>}<div className="write-prompt-actions"><button className="secondary-button" type="button" onClick={onCancelRangeWrite}>Cancel</button><button className="secondary-button" type="button" onClick={() => onConfirmRangeWrite(rangeWritePrompt.selected.filter((draft) => !draft.existing))}>Write new only</button><button className="primary-action" type="button" onClick={() => onConfirmRangeWrite(rangeWritePrompt.selected)}>Write selected</button></div></div></div>}

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
                  <textarea className="summary-editor" aria-label="Worklog summary" value={summary} onChange={(event) => onSummaryChange(event.target.value)} onBlur={() => onSummaryCommit?.()} />
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
                      <div className="summary-actions">
                        <button className="compact-button" type="button" onClick={onCopy}><Clipboard size={14} />Copy</button>
                        <button className="primary-action compact-button" type="button" onClick={onWriteSummary}><Check size={14} />Write to Sheet</button>
                      </div>
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

              {showHistory && <section className="panel history-panel">
                <PanelHeader eyebrow="Saved" title="Summary history" />
                <input className="history-search" value={historyQuery} placeholder="Search date, repo, or summary" onChange={(event) => onHistoryQueryChange(event.target.value)} />
                {!history.length && (
                  <div className="empty-history">No summaries yet. Generate your first worklog.</div>
                )}
                <div className="history-list">
                  {history.filter((entry) => {
                    const query = historyQuery.trim().toLowerCase();
                    return !query || [entry.workDate, entry.summary, ...(entry.repos || [])].join(" ").toLowerCase().includes(query);
                  }).map((entry) => (
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
                {history.length > 0 && !history.some((entry) => [entry.workDate, entry.summary, ...(entry.repos || [])].join(" ").toLowerCase().includes(historyQuery.trim().toLowerCase())) && <div className="empty-history">No matching summaries.</div>}
              </section>}
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
