"use client";

import { CalendarOff, Clock3, Play, Power } from "lucide-react";

const weekdays = [
  [1, "M"],
  [2, "T"],
  [3, "W"],
  [4, "T"],
  [5, "F"],
  [6, "S"],
  [7, "S"],
];

function formatStatus(value) {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function schedulerLabel(scheduler) {
  if (!scheduler?.active) return "Not active";
  return "Active";
}

function todayLabel(automation, automationStatus) {
  if (automation.skipDate) return "Skipped";
  const attempt = automationStatus?.lastAutomaticAttempt;
  const today = new Date().toLocaleDateString("en-CA");
  if (attempt?.workDate !== today) return "Scheduled";
  if (attempt.status === "success") return "Completed";
  if (attempt.status === "running") return "Running";
  // A no_activity result only settles the day once it happened at or after the
  // scheduled time; an earlier one still leaves the scheduled run due.
  if (attempt.status === "no_activity") {
    const [hour, minute] = String(automation.time || "").split(":").map(Number);
    const created = new Date(attempt.createdAt);
    if (Number.isNaN(created.valueOf()) || Number.isNaN(hour)) return "No activity";
    return created.getHours() * 60 + created.getMinutes() < hour * 60 + minute
      ? "Scheduled"
      : "No activity";
  }
  return "Scheduled";
}

function errorAdvice(message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("google") || text.includes("sheet")) return "Check Google connection, sheet link, tab, and headers.";
  if (text.includes("gemini")) return "Check the Gemini API key and model availability.";
  if (text.includes("github") || text.includes("token")) return "Check the GitHub token, author, and repository access.";
  if (text.includes("local") || text.includes("git")) return "Check the repository folder and local Git identity.";
  if (text.includes("foreign key") || text.includes("database")) return "Run Setup Check, then restart the app if it continues.";
  return "Run Setup Check and try again.";
}

export function AutomationSection({
  available,
  automation,
  automationBusy,
  automationMessage,
  automationStatus,
  automationUnavailableMessage,
  onChange,
  onRunNow,
}) {
  function toggleDay(day) {
    const days = automation.days.includes(day)
      ? automation.days.filter((value) => value !== day)
      : [...automation.days, day].sort();
    if (days.length) onChange({ days });
  }

  return (
    <section className="panel settings-panel">
      <header className="settings-panel-header">
        <h2>Automation</h2>
        <p>Generate and write your worklog automatically on selected weekdays.</p>
      </header>
      <div className="settings-fields">
        <label className="automation-toggle">
          <span>
            <strong>Enable automatic worklogs</strong>
            <small>Runs locally while you are signed in.</small>
          </span>
          <input
            checked={automation.enabled}
            disabled={!available || automationBusy}
            type="checkbox"
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
        </label>

        <div className="automation-schedule">
          <label className="settings-field">
            <span>Run time</span>
            <span className="automation-time">
              <Clock3 size={15} />
              <input
                type="time"
                value={automation.time}
                onChange={(event) => onChange({ time: event.target.value })}
              />
            </span>
          </label>
          <label className="settings-field">
            <span>Days</span>
            <span className="weekday-picker">
              {weekdays.map(([day, label]) => (
                <button
                  aria-label={`ISO weekday ${day}`}
                  className={automation.days.includes(day) ? "active" : ""}
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                >
                  {label}
                </button>
              ))}
            </span>
          </label>
        </div>

        <label className="automation-toggle">
          <span>
            <strong><Power size={14} /> Start at login</strong>
            <small>Keep the agent available in the system tray.</small>
          </span>
          <input
            checked={automation.startAtLogin}
            disabled={!available || automationBusy}
            type="checkbox"
            onChange={(event) => onChange({ startAtLogin: event.target.checked })}
          />
        </label>

        <button
          className="primary-action automation-run"
          disabled={!available || automationBusy}
          type="button"
          onClick={onRunNow}
        >
          <Play size={15} />
          {automationBusy ? "Running" : "Run now"}
        </button>
        <button
          className="secondary-button automation-run"
          disabled={!available || automationBusy}
          type="button"
          onClick={() => onChange({ skipDate: automation.skipDate ? null : new Date().toISOString().slice(0, 10) })}
        >
          <CalendarOff size={15} />
          {automation.skipDate ? "Resume today" : "Skip today"}
        </button>

        {!available && (
          <p className="settings-status">{automationUnavailableMessage}</p>
        )}
        {automationMessage && <p className="settings-status">{automationMessage}</p>}

        <dl className="automation-status">
          <div><dt>Scheduler</dt><dd>{schedulerLabel(automationStatus?.scheduler)}<small className="automation-advice">Last check: {formatStatus(automationStatus?.scheduler?.lastCheckAt)}{automationStatus?.scheduler?.lastResult ? ` · ${automationStatus.scheduler.lastResult}` : ""}</small></dd></div>
          <div><dt>Next run</dt><dd>{formatStatus(automationStatus?.nextRun)}</dd></div>
          <div><dt>Last automatic run</dt><dd>{formatStatus(automationStatus?.lastAutomaticAttempt?.createdAt)}{automationStatus?.lastAutomaticAttempt?.status && <small className="automation-advice">Status: {automationStatus.lastAutomaticAttempt.status}</small>}</dd></div>
          <div><dt>Last manual run</dt><dd>{formatStatus(automationStatus?.lastManualAttempt?.createdAt)}{automationStatus?.lastManualAttempt?.status && <small className="automation-advice">Status: {automationStatus.lastManualAttempt.status}</small>}</dd></div>
          <div><dt>Last successful write</dt><dd>{formatStatus(automationStatus?.lastSuccess?.completedAt)}</dd></div>
          <div><dt>Latest automatic error</dt><dd>{automationStatus?.lastAutomaticError?.errorMessage ? <>{automationStatus.lastAutomaticError.errorMessage}<small className="automation-advice">{formatStatus(automationStatus.lastAutomaticError.completedAt)} · {errorAdvice(automationStatus.lastAutomaticError.errorMessage)}</small></> : "None"}</dd></div>
          <div><dt>Today</dt><dd>{todayLabel(automation, automationStatus)}</dd></div>
        </dl>
      </div>
    </section>
  );
}
