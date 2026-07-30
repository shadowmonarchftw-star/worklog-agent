"use client";

import { useEffect, useState } from "react";
import { createHistoryEntry } from "../lib/worklogHistory.mjs";

const sampleActivity = `repo: billing-api
- commit 9f12c3a fix invoice retry logic for failed card payments
- commit a41b9d0 add tests for payment failure validation

repo: dashboard
- PR #42 merged: improve customer activity export button
- commit e83aa91 clean up table empty state`;

export default function Home() {
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubAuthor, setGithubAuthor] = useState("");
  const [repos, setRepos] = useState([]);
  const [selectedRepos, setSelectedRepos] = useState([]);
  const [developerName, setDeveloperName] = useState("");
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [style, setStyle] = useState("standup");
  const [theme, setTheme] = useState("dark");
  const [activity, setActivity] = useState(sampleActivity);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    async function loadLocalData() {
      const [settingsResponse, historyResponse] = await Promise.all([
        fetch("/api/local/settings"),
        fetch("/api/local/history"),
      ]);

      if (settingsResponse.ok) {
        const { settings } = await settingsResponse.json();
        setGeminiApiKey(settings.geminiApiKey || "");
        setGithubToken(settings.githubToken || "");
        setGithubAuthor(settings.githubAuthor || "");
        setDeveloperName(settings.developerName || "");
        setStyle(settings.style || "standup");
        setTheme(settings.theme || "dark");
        setSelectedRepos(settings.selectedRepos || []);
      }

      if (historyResponse.ok) {
        const { history } = await historyResponse.json();
        setHistory(history);
      }
    }

    loadLocalData();
  }, []);

  async function saveSettings(nextSettings = {}) {
    await fetch("/api/local/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          geminiApiKey,
          githubToken,
          githubAuthor,
          developerName,
          style,
          theme,
          selectedRepos,
          ...nextSettings,
        },
      }),
    });
  }

  async function loadRepos() {
    setGithubLoading(true);
    setError("");

    const response = await fetch("/api/github/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubToken }),
    });

    const data = await response.json();
    setGithubLoading(false);

    if (!response.ok) {
      setError(data.error || "Could not load GitHub repositories.");
      return;
    }

    setRepos(data.repos);
    const nextSelectedRepos = data.repos[0]?.fullName ? [data.repos[0].fullName] : [];
    setSelectedRepos(nextSelectedRepos);
    saveSettings({ selectedRepos: nextSelectedRepos });
  }

  function toggleRepo(repoFullName) {
    setSelectedRepos((current) => {
      const nextSelectedRepos = current.includes(repoFullName)
        ? current.filter((repo) => repo !== repoFullName)
        : [...current, repoFullName];
      saveSettings({ selectedRepos: nextSelectedRepos });
      return nextSelectedRepos;
    });
  }

  async function fetchGithubActivity() {
    setGithubLoading(true);
    setError("");

    const response = await fetch("/api/github/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        githubToken,
        repoFullNames: selectedRepos,
        date: workDate,
        author: githubAuthor,
      }),
    });

    const data = await response.json();
    setGithubLoading(false);

    if (!response.ok) {
      setError(data.error || "Could not fetch GitHub activity.");
      return;
    }

    setActivity(data.activity);
  }

  async function generateSummary(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSummary("");

    const response = await fetch("/api/generate-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geminiApiKey,
        developerName,
        workDate,
        style,
        activity,
      }),
    });

    const data = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(data.error || "Something went wrong.");
      return;
    }

    setSummary(data.summary);
    const entry = createHistoryEntry({
      developerName,
      workDate,
      style,
      selectedRepos,
      activity,
      summary: data.summary,
    });
    const historyResponse = await fetch("/api/local/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry }),
    });
    if (historyResponse.ok) {
      const { history } = await historyResponse.json();
      setHistory(history);
    }
    saveSettings();
  }

  function restoreHistoryEntry(entry) {
    setDeveloperName(entry.developerName);
    setWorkDate(entry.workDate);
    setStyle(entry.style);
    setSelectedRepos(entry.repos || []);
    setActivity(entry.activity);
    setSummary(entry.summary);
    setError("");
  }

  async function deleteHistoryEntry(entryId) {
    const response = await fetch("/api/local/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entryId }),
    });

    if (response.ok) {
      const { history } = await response.json();
      setHistory(history);
    }
  }

  return (
    <main className="shell" data-theme={theme}>
      <section className="intro">
        <div className="brand">
          <span className="eyebrow">Local Agent Prototype</span>
          <h1>AI Worklog Agent</h1>
        </div>
        <p>
          Fetch GitHub activity, generate a daily work summary, and keep history
          in local SQLite.
        </p>
        <div className="theme-switch" aria-label="Theme">
          <button
            className={theme === "dark" ? "active" : ""}
            aria-label="Use dark theme"
            title="Dark"
            type="button"
            onClick={() => {
              setTheme("dark");
              saveSettings({ theme: "dark" });
            }}
          >
            <span className="theme-icon moon" aria-hidden="true" />
          </button>
          <button
            className={theme === "light" ? "active" : ""}
            aria-label="Use light theme"
            title="Light"
            type="button"
            onClick={() => {
              setTheme("light");
              saveSettings({ theme: "light" });
            }}
          >
            <span className="theme-icon sun" aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="workspace">
        <form className="panel form" onSubmit={generateSummary}>
          <div className="section">
            <p className="eyebrow">GitHub</p>
            <label>
              GitHub fine-grained token
              <input
                type="password"
                value={githubToken}
                onChange={(event) => setGithubToken(event.target.value)}
                onBlur={() => saveSettings({ githubToken })}
                placeholder="Paste token here"
                autoComplete="off"
              />
              <span className="hint">
                Local prototype only. Token is sent to this local app server to
                read repos and commits.
              </span>
            </label>

            <label>
              Commit author
              <input
                value={githubAuthor}
                onChange={(event) => setGithubAuthor(event.target.value)}
                onBlur={() => saveSettings({ githubAuthor })}
                placeholder="GitHub username, optional"
              />
            </label>

            <label>
              Repositories
              <div className="repo-list">
                {!repos.length && <span className="hint">Load repos first</span>}
                {repos.map((repo) => (
                  <label className="repo-option" key={repo.id}>
                    <input
                      type="checkbox"
                      checked={selectedRepos.includes(repo.fullName)}
                      onChange={() => toggleRepo(repo.fullName)}
                    />
                    <span>{repo.fullName}</span>
                  </label>
                ))}
              </div>
            </label>

            <div className="actions">
              <button disabled={githubLoading || !githubToken} type="button" onClick={loadRepos}>
                {githubLoading ? "Working..." : "Load Repos"}
              </button>
              <button
                disabled={githubLoading || !githubToken || !selectedRepos.length}
                type="button"
                onClick={fetchGithubActivity}
              >
                Fetch Activity ({selectedRepos.length})
              </button>
            </div>
          </div>

          <label>
            Gemini API key
            <input
              type="password"
              value={geminiApiKey}
              onChange={(event) => setGeminiApiKey(event.target.value)}
              onBlur={() => saveSettings({ geminiApiKey })}
              placeholder="Paste key from Google AI Studio"
              autoComplete="off"
            />
            <span className="hint">
              Required for AI summaries. Paste your key from Google AI Studio or
              set GEMINI_API_KEY in .env.local.
            </span>
          </label>

          <div className="row">
            <label>
              Developer
              <input
                value={developerName}
                onChange={(event) => setDeveloperName(event.target.value)}
                onBlur={() => saveSettings({ developerName })}
                placeholder="Your name"
              />
            </label>
            <label>
              Date
              <input
                type="date"
                value={workDate}
                onChange={(event) => setWorkDate(event.target.value)}
              />
            </label>
          </div>

          <label>
            Summary style
            <select
              value={style}
              onChange={(event) => {
                setStyle(event.target.value);
                saveSettings({ style: event.target.value });
              }}
            >
              <option value="standup">Standup</option>
              <option value="concise">Concise</option>
              <option value="detailed">Detailed</option>
              <option value="timesheet">Timesheet</option>
            </select>
          </label>

          <label>
            GitHub activity
            <textarea
              value={activity}
              onChange={(event) => setActivity(event.target.value)}
              rows={14}
              placeholder="Paste commits, PR titles, merge notes, or git log output"
            />
          </label>

          <button disabled={loading} type="submit">
            {loading ? "Generating..." : "Generate Summary"}
          </button>
        </form>

        <aside className="panel result">
          <div>
            <p className="eyebrow">Daily Log</p>
            <h2>Generated summary</h2>
          </div>
          {error && <p className="error">{error}</p>}
          {!error && !summary && (
            <p className="empty">
              Your generated work log will appear here. Use the sample activity
              to test the first run.
            </p>
          )}
          {summary && <pre>{summary}</pre>}

          <div className="history">
            <div>
              <p className="eyebrow">Saved</p>
              <h2>Summary history</h2>
            </div>
            {!history.length && <p className="empty">Generated summaries save here.</p>}
            {history.map((entry) => (
              <article className="history-item" key={entry.id}>
                <button type="button" onClick={() => restoreHistoryEntry(entry)}>
                  <span>{entry.workDate}</span>
                  <small>{entry.repos?.join(", ") || entry.style}</small>
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => deleteHistoryEntry(entry.id)}
                >
                  Delete
                </button>
              </article>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
