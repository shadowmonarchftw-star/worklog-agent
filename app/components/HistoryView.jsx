"use client";
import { CalendarRange, Copy, FileText, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "./DashboardView";

// A rollup is read-only: it is never saved to history and never written to the
// sheet, because it belongs to a period rather than to one dated row.
function RollupPanel({ history }) {
  const [period, setPeriod] = useState("week");
  const [reference, setReference] = useState(() => new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    setStatus("");
    setResult(null);
    try {
      const response = await fetch("/api/generate-rollup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, reference }),
      });
      const data = await response.json();
      if (!response.ok) setStatus(data.error || "Could not generate the rollup.");
      else setResult(data);
    } catch {
      setStatus("Could not generate the rollup.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rollup-panel">
      <div className="panel-eyebrow"><CalendarRange size={14} /> Period rollup</div>
      <p className="rollup-hint">Combine the saved daily summaries in a period into one update for a standup, a sprint review, or a self-review.</p>
      <div className="rollup-controls">
        <div className="rollup-periods">
          <button className={period === "week" ? "active" : ""} type="button" onClick={() => setPeriod("week")}>Week</button>
          <button className={period === "month" ? "active" : ""} type="button" onClick={() => setPeriod("month")}>Month</button>
        </div>
        <input aria-label="Any date in the period" type="date" value={reference} onChange={(event) => setReference(event.target.value)} />
        <button className="secondary-button" disabled={busy || !reference || !history.length} type="button" onClick={generate}>{busy ? "Generating" : "Generate rollup"}</button>
      </div>
      {status && <div className="rollup-status">{status}</div>}
      {result && (
        <div className="rollup-result">
          <div className="rollup-result-meta"><span>{result.start} to {result.end}</span><span>{result.dayCount} day{result.dayCount === 1 ? "" : "s"} of work</span></div>
          <textarea className="summary-editor" aria-label="Period rollup" readOnly value={result.summary} />
          <button className="secondary-button" type="button" onClick={() => { navigator.clipboard.writeText(result.summary); setStatus("Rollup copied."); }}><Copy size={14} /> Copy</button>
        </div>
      )}
    </section>
  );
}

export function HistoryView({ history, query, deletedHistory, onQueryChange, onDelete, onUndoDelete, onRestore }) {
  const [page, setPage] = useState(0);
  const [writes, setWrites] = useState([]);
  useEffect(() => { fetch("/api/google/audit").then((r) => r.json()).then((d) => setWrites(d.writes || [])).catch(() => {}); }, []);
  const filtered = history.filter((entry) => !query.trim() || [entry.workDate, entry.summary, ...(entry.repos || [])].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  const pageSize = 20, pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)), visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const days = [...history].sort((a, b) => a.workDate.localeCompare(b.workDate)).slice(-14);
  const max = Math.max(1, ...days.map((e) => (e.commitCount || 0) + (e.pullRequestCount || 0)));
  const commits = history.reduce((n, e) => n + (e.commitCount || 0), 0), prs = history.reduce((n, e) => n + (e.pullRequestCount || 0), 0), repos = new Set(history.flatMap((e) => e.repos || [])).size;
  return <><PageHeader eyebrow="History / Saved worklogs" title="Summary history" subtitle="Find, review, and restore previous worklogs." /><div className="page-scroll"><div className="history-page panel"><div className="activity-overview"><div><span>Commits</span><strong>{commits}</strong></div><div><span>Pull requests</span><strong>{prs}</strong></div><div><span>Active days</span><strong>{history.length}</strong></div><div><span>Repositories</span><strong>{repos}</strong></div></div>{days.length > 0 && <section className="activity-chart"><div className="panel-eyebrow">Activity by day</div><div className="chart-bars">{days.map((entry) => { const total = (entry.commitCount || 0) + (entry.pullRequestCount || 0); return <div className="chart-day" title={`${entry.workDate}: ${entry.commitCount || 0} commits, ${entry.pullRequestCount || 0} PRs`} key={entry.id}><div className="chart-bar" style={{ height: `${Math.max(8, total / max * 100)}%` }}><i style={{ height: `${total ? (entry.commitCount || 0) / total * 100 : 0}%` }} /></div><span>{entry.workDate.slice(5)}</span></div>; })}</div><small className="chart-legend">Green: commits · muted: pull requests</small></section>}{history.length > 0 && <RollupPanel history={history} />}{deletedHistory && <div className="undo-banner">History entry deleted. <button type="button" onClick={onUndoDelete}>Undo</button></div>}<div className="history-search-wrap"><Search size={15} /><input value={query} placeholder="Search date, repository, or summary" onChange={(e) => { setPage(0); onQueryChange(e.target.value); }} /></div>{!filtered.length ? <div className="empty-state"><FileText size={22} /><strong>{history.length ? "No matching summaries" : "No summaries yet"}</strong></div> : <><div className="history-page-list">{visible.map((entry) => <article className="history-page-row" key={entry.id}><button type="button" onClick={() => onRestore(entry)}><strong>{entry.workDate}</strong><span>{entry.repos?.join(", ") || "Saved worklog"} · {entry.commitCount || 0} commits · {entry.pullRequestCount || 0} PRs</span><p>{entry.summary}</p></button><button className="icon-button danger" aria-label={`Delete summary for ${entry.workDate}`} type="button" onClick={() => onDelete(entry.id)}><Trash2 size={15} /></button></article>)}</div><div className="history-pagination"><button className="secondary-button" disabled={!page} type="button" onClick={() => setPage((n) => n - 1)}>Previous</button><span>Page {page + 1} of {pageCount}</span><button className="secondary-button" disabled={page + 1 >= pageCount} type="button" onClick={() => setPage((n) => n + 1)}>Next</button></div></>}</div></div></>;
}
