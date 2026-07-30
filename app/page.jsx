"use client";

import { useEffect, useState } from "react";
import { createHistoryEntry } from "../lib/worklogHistory.mjs";

export default function Home() {
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubAuthor, setGithubAuthor] = useState("");
  const [githubAuthors, setGithubAuthors] = useState([]);
  const [repos, setRepos] = useState([]);
  const [selectedRepos, setSelectedRepos] = useState([]);
  const [developerName, setDeveloperName] = useState("");
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [style, setStyle] = useState("standup");
  const [theme, setTheme] = useState("dark");
  const [activity, setActivity] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [view, setView] = useState("worklog");
  const [showActivity, setShowActivity] = useState(false);

  const setupComplete = Boolean(githubToken && geminiApiKey && selectedRepos.length);

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
        if (settings.githubToken && settings.selectedRepos?.length) {
          loadAuthors(settings.selectedRepos, settings.githubToken);
        } else if (settings.githubToken) {
          loadAuthors([], settings.githubToken);
        }
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
    if (nextSelectedRepos.length) {
      loadAuthors(nextSelectedRepos);
    }
  }

  async function loadAuthors(repoNames = selectedRepos, token = githubToken) {
    if (!token) {
      setGithubAuthors([]);
      return;
    }

    const response = await fetch("/api/github/authors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubToken: token, repoFullNames: repoNames }),
    });

    const data = await response.json();
    if (response.ok) {
      setGithubAuthors(data.authors || []);
    }
  }

  function toggleRepo(repoFullName) {
    setSelectedRepos((current) => {
      const nextSelectedRepos = current.includes(repoFullName)
        ? current.filter((repo) => repo !== repoFullName)
        : [...current, repoFullName];
      saveSettings({ selectedRepos: nextSelectedRepos });
      loadAuthors(nextSelectedRepos);
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
    return data.activity;
  }

  async function generateSummaryFromActivity(nextActivity) {
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
        activity: nextActivity,
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
      activity: nextActivity,
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

  async function generateSummary(event) {
    event.preventDefault();
    await generateSummaryFromActivity(activity);
  }

  async function generateTodayWorklog() {
    const nextActivity = await fetchGithubActivity();
    if (nextActivity) {
      await generateSummaryFromActivity(nextActivity);
    }
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
        <nav className="top-nav" aria-label="App views">
          <button
            className={view === "worklog" ? "active" : ""}
            aria-label="Worklog"
            title="Worklog"
            type="button"
            onClick={() => setView("worklog")}
          >
            <span className="nav-icon worklog-icon" aria-hidden="true" />
          </button>
          <button
            className={view === "settings" ? "active" : ""}
            aria-label="Settings"
            title="Settings"
            type="button"
            onClick={() => setView("settings")}
          >
            <span className="nav-icon settings-icon" aria-hidden="true" />
          </button>
        </nav>
      </section>

      {view === "settings" && (
        <section className="settings-layout">
          <form className="panel form" onSubmit={(event) => event.preventDefault()}>
            <div className="section">
              <p className="eyebrow">Credentials</p>
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
                  Stored locally in SQLite. Used to read repos, commits, and PRs.
                </span>
              </label>

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
                  Stored locally in SQLite. Used to generate summaries.
                </span>
              </label>
            </div>

            <div className="section">
              <p className="eyebrow">Profile</p>
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
                  GitHub commit author
                  <select
                    value={githubAuthor}
                    onChange={(event) => setGithubAuthor(event.target.value)}
                    onBlur={() => saveSettings({ githubAuthor })}
                  >
                    <option value="">Select author</option>
                    {githubAuthors.map((author) => (
                      <option key={author.value} value={author.value}>
                        {author.label}
                      </option>
                    ))}
                    {githubAuthor && !githubAuthors.some((author) => author.value === githubAuthor) && (
                      <option value={githubAuthor}>{githubAuthor}</option>
                    )}
                  </select>
                </label>
              </div>
              <p className="hint field-note">
                Commit author filters shared repos to only your commits and PRs.
                Load repos first if list is empty.
              </p>

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
                  <option value="bullet-points">Bullet points</option>
                </select>
              </label>
            </div>

            <div className="section">
              <p className="eyebrow">Repositories</p>
              <button disabled={githubLoading || !githubToken} type="button" onClick={loadRepos}>
                {githubLoading ? "Working..." : "Load Repos"}
              </button>
              <label>
                Monitored repos
                <div className="repo-list">
                  {!repos.length && <span className="hint">Load repos after adding GitHub token</span>}
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
            </div>

            <div>
              <p className="eyebrow">Appearance</p>
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
            </div>
          </form>
        </section>
      )}

      {view === "worklog" && (
        <section className="workspace">
          <form className="panel form" onSubmit={generateSummary}>
            <div className="section">
              <p className="eyebrow">Today</p>
              <h2>{setupComplete ? `${selectedRepos.length} repos selected` : "Setup needed"}</h2>
              {!setupComplete && (
                <p className="setup-note">
                  Add keys and repos in Settings, then return here.
                </p>
              )}
              <div className="row">
                <label>
                  Date
                  <input
                    type="date"
                    value={workDate}
                    onChange={(event) => setWorkDate(event.target.value)}
                  />
                </label>
                <button
                  disabled={githubLoading || loading || !setupComplete}
                  type="button"
                  onClick={generateTodayWorklog}
                >
                  {githubLoading || loading ? "Working..." : "Generate Worklog"}
                </button>
              </div>
              <button className="ghost-button" type="button" onClick={() => setShowActivity(!showActivity)}>
                {showActivity ? "Hide Activity" : "Inspect Activity"}
              </button>
            </div>

            {showActivity && (
              <>
                <label>
                  GitHub activity
                  <textarea
                    value={activity}
                    onChange={(event) => setActivity(event.target.value)}
                    rows={14}
                    placeholder="Fetched commits and PR activity appear here"
                  />
                </label>

                <button disabled={loading || !geminiApiKey || !activity} type="submit">
                  {loading ? "Generating..." : "Regenerate From Activity"}
                </button>
              </>
            )}
          </form>

          <aside className="panel result">
            <div>
              <p className="eyebrow">Daily Log</p>
              <h2>Generated summary</h2>
            </div>
            {error && <p className="error">{error}</p>}
            {!error && !summary && (
              <p className="empty">
                Your generated work log will appear here.
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
      )}

    </main>
  );
}
