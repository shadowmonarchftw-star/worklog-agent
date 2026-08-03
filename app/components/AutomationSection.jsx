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
          <div><dt>Next run</dt><dd>{formatStatus(automationStatus?.nextRun)}</dd></div>
          <div><dt>Last attempt</dt><dd>{formatStatus(automationStatus?.lastAttempt?.startedAt)}</dd></div>
          <div><dt>Last successful write</dt><dd>{formatStatus(automationStatus?.lastSuccess?.completedAt)}</dd></div>
          <div><dt>Latest error</dt><dd>{automationStatus?.lastError?.errorMessage || "None"}{automationStatus?.lastError?.errorMessage && <small className="automation-advice">{errorAdvice(automationStatus.lastError.errorMessage)}</small>}</dd></div>
          <div><dt>Today</dt><dd>{automation.skipDate ? "Skipped" : "Scheduled"}</dd></div>
        </dl>
      </div>
    </section>
  );
}
