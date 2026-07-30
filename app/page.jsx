"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "./components/AppShell";
import { DashboardView } from "./components/DashboardView";
import { SettingsView } from "./components/SettingsView";
import { createHistoryEntry } from "../lib/worklogHistory.mjs";
import {
  activityInputKey,
  canWriteToGoogle,
  hasWorkActivity,
  isCurrentActivityRequest,
  reconcileRepoSelection,
} from "../lib/worklogWorkflow.mjs";

export default function Home() {
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubAuthor, setGithubAuthor] = useState("");
  const [githubAuthors, setGithubAuthors] = useState([]);
  const [googleSheetLink, setGoogleSheetLink] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [googleSheetTab, setGoogleSheetTab] = useState("Sheet1");
  const [defaultHours, setDefaultHours] = useState("8");
  const [googleConnected, setGoogleConnected] = useState(false);
  const [sheetStatus, setSheetStatus] = useState("");
  const [repos, setRepos] = useState([]);
  const [selectedRepos, setSelectedRepos] = useState([]);
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [style, setStyle] = useState("standup");
  const [theme, setTheme] = useState("dark");
  const [activity, setActivity] = useState("");
  const [commitCount, setCommitCount] = useState(0);
  const [pullRequestCount, setPullRequestCount] = useState(0);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState("");
  const [githubLoading, setGithubLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [view, setView] = useState("dashboard");
  const [showActivity, setShowActivity] = useState(false);
  const requestIdRef = useRef(0);
  const initializedRef = useRef(false);
  const suppressResetRef = useRef(false);

  const setupComplete = Boolean(
    githubToken && geminiApiKey && githubAuthor && selectedRepos.length,
  );
  const currentInputKey = activityInputKey({
    workDate,
    githubAuthor,
    githubToken,
    selectedRepos,
  });

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
        setGoogleSheetLink(settings.googleSheetLink || "");
        setGoogleClientId(settings.googleClientId || "");
        setGoogleClientSecret(settings.googleClientSecret || "");
        setGoogleSheetTab(settings.googleSheetTab || "Sheet1");
        setDefaultHours(settings.defaultHours || "8");
        setStyle(settings.style === "timesheet" ? "sheet-cell" : settings.style || "standup");
        setTheme(settings.theme || "dark");
        setSelectedRepos(settings.selectedRepos || []);
        if (settings.githubToken) {
          void loadAuthors(settings.selectedRepos || [], settings.githubToken);
        }
      }

      if (historyResponse.ok) {
        const { history: savedHistory } = await historyResponse.json();
        setHistory(savedHistory);
      }

      await loadGoogleStatus();
      initializedRef.current = true;
    }

    void loadLocalData();
  }, []);

  useEffect(() => {
    window.addEventListener("focus", loadGoogleStatus);
    return () => window.removeEventListener("focus", loadGoogleStatus);
  }, []);

  useEffect(() => {
    if (!initializedRef.current) return;
    if (suppressResetRef.current) {
      suppressResetRef.current = false;
      return;
    }
    requestIdRef.current += 1;
    setLoading("");
    setActivity("");
    setCommitCount(0);
    setPullRequestCount(0);
    setSummary("");
    setError("");
    setSheetStatus("");
    setShowActivity(false);
  }, [currentInputKey]);

  async function loadGoogleStatus() {
    const response = await fetch("/api/google/status");
    if (response.ok) {
      const data = await response.json();
      setGoogleConnected(Boolean(data.connected));
    }
  }

  async function saveSettings(nextSettings = {}) {
    await fetch("/api/local/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          geminiApiKey,
          githubToken,
          githubAuthor,
          googleSheetLink,
          googleClientId,
          googleClientSecret,
          googleSheetTab,
          defaultHours,
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
    const nextSelectedRepos = reconcileRepoSelection(selectedRepos, data.repos);
    setSelectedRepos(nextSelectedRepos);
    await saveSettings({ selectedRepos: nextSelectedRepos });
    await loadAuthors(nextSelectedRepos);
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
    if (response.ok) setGithubAuthors(data.authors || []);
  }

  function toggleRepo(repoFullName) {
    const nextSelectedRepos = selectedRepos.includes(repoFullName)
      ? selectedRepos.filter((repo) => repo !== repoFullName)
      : [...selectedRepos, repoFullName];
    setSelectedRepos(nextSelectedRepos);
    void saveSettings({ selectedRepos: nextSelectedRepos });
    void loadAuthors(nextSelectedRepos);
  }

  async function fetchGithubActivity({ reveal = false } = {}) {
    const requestId = ++requestIdRef.current;
    const started = { requestId, inputKey: currentInputKey };
    setLoading("activity");
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
    const current = {
      requestId: requestIdRef.current,
      inputKey: activityInputKey({
        workDate,
        githubAuthor,
        githubToken,
        selectedRepos,
      }),
    };
    if (!isCurrentActivityRequest(started, current)) return null;
    setLoading("");

    if (!response.ok) {
      setError(data.error || "Could not fetch GitHub activity.");
      return null;
    }

    setActivity(data.activity);
    setCommitCount(data.commitCount || 0);
    setPullRequestCount(data.pullRequestCount || 0);
    if (reveal) setShowActivity(true);
    return data;
  }

  async function generateSummaryFromActivity(activityResult) {
    const started = {
      requestId: requestIdRef.current,
      inputKey: currentInputKey,
    };
    setLoading("summary");
    setError("");
    const response = await fetch("/api/generate-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geminiApiKey,
        workDate,
        style,
        activity: activityResult.activity,
      }),
    });
    const data = await response.json();
    const current = {
      requestId: requestIdRef.current,
      inputKey: activityInputKey({
        workDate,
        githubAuthor,
        githubToken,
        selectedRepos,
      }),
    };
    if (!isCurrentActivityRequest(started, current)) return;
    setLoading("");

    if (!response.ok) {
      setError(data.error || "Could not generate the worklog.");
      return;
    }

    setSummary(data.summary);
    if (requestIdRef.current !== started.requestId) return;
    const entry = createHistoryEntry({
      workDate,
      style,
      selectedRepos,
      activity: activityResult.activity,
      summary: data.summary,
    });
    const historyResponse = await fetch("/api/local/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry }),
    });
    if (requestIdRef.current !== started.requestId) return;
    if (historyResponse.ok) {
      const { history: savedHistory } = await historyResponse.json();
      setHistory(savedHistory);
    }
    await saveSettings();
    if (requestIdRef.current !== started.requestId) return;
    await writeSummaryToSheet(data.summary);
  }

  async function generateTodayWorklog() {
    const result = await fetchGithubActivity();
    if (!result) return;
    if (!hasWorkActivity(result)) {
      setShowActivity(true);
      setError("No commits or pull requests were found for the selected date.");
      return;
    }
    await generateSummaryFromActivity(result);
  }

  async function inspectActivity() {
    await fetchGithubActivity({ reveal: true });
  }

  async function connectGoogle() {
    setError("");
    setSheetStatus("Opening Google...");
    await saveSettings({ googleClientId, googleClientSecret, googleSheetLink, googleSheetTab, defaultHours });
    const response = await fetch("/api/google/auth-url");
    const data = await response.json();
    if (!response.ok) {
      setSheetStatus("");
      setError(data.error || "Could not start Google connection.");
      return;
    }
    window.open(data.url, "_blank", "width=720,height=780");
    setSheetStatus("Finish Google login, then return here.");
    setTimeout(loadGoogleStatus, 2500);
  }

  async function writeSummaryToSheet(nextSummary) {
    if (!canWriteToGoogle({ googleSheetLink, googleConnected, summary: nextSummary })) {
      if (googleSheetLink && !googleConnected) {
        setSheetStatus("Connect Google in Settings to write this summary.");
      }
      return;
    }
    setSheetStatus("Writing to Google Sheet...");
    const response = await fetch("/api/google/write-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workDate, summary: nextSummary, reference: selectedRepos.join(", ") }),
    });
    const data = await response.json();
    if (!response.ok) {
      setSheetStatus(data.error || "Could not write to Google Sheet.");
      return;
    }
    setSheetStatus(data.action === "updated" ? `Google Sheet row ${data.rowNumber} updated` : "Google Sheet row added");
  }

  function restoreHistoryEntry(entry) {
    requestIdRef.current += 1;
    suppressResetRef.current =
      activityInputKey({
        workDate: entry.workDate,
        githubAuthor,
        githubToken,
        selectedRepos: entry.repos || [],
      }) !== currentInputKey;
    setWorkDate(entry.workDate);
    setStyle(entry.style);
    setSelectedRepos(entry.repos || []);
    setActivity(entry.activity);
    setSummary(entry.summary);
    setCommitCount(0);
    setPullRequestCount(0);
    setShowActivity(false);
    setError("");
    setSheetStatus("");
  }

  async function deleteHistoryEntry(entryId) {
    const response = await fetch("/api/local/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entryId }),
    });
    if (response.ok) {
      const { history: savedHistory } = await response.json();
      setHistory(savedHistory);
    }
  }

  function changeTheme(nextTheme) {
    setTheme(nextTheme);
    void saveSettings({ theme: nextTheme });
  }

  const sharedSettings = {
    defaultHours,
    geminiApiKey,
    githubAuthor,
    githubAuthors,
    githubLoading,
    githubToken,
    googleClientId,
    googleClientSecret,
    googleConnected,
    googleSheetLink,
    googleSheetTab,
    onAuthorChange: (value) => { setGithubAuthor(value); void saveSettings({ githubAuthor: value }); },
    onConnectGoogle: connectGoogle,
    onDefaultHoursChange: setDefaultHours,
    onGeminiApiKeyChange: setGeminiApiKey,
    onGithubTokenChange: setGithubToken,
    onGoogleClientIdChange: setGoogleClientId,
    onGoogleClientSecretChange: setGoogleClientSecret,
    onGoogleSheetLinkChange: setGoogleSheetLink,
    onGoogleSheetTabChange: setGoogleSheetTab,
    onLoadRepos: loadRepos,
    onSave: saveSettings,
    onStyleChange: setStyle,
    onThemeChange: changeTheme,
    onToggleRepo: toggleRepo,
    repos,
    selectedRepos,
    sheetStatus,
    style,
    theme,
  };

  return (
    <AppShell
      githubConnected={Boolean(githubToken)}
      googleConnected={googleConnected}
      navigationDisabled={Boolean(loading)}
      onThemeChange={changeTheme}
      onViewChange={setView}
      theme={theme}
      view={view}
    >
      {view === "dashboard" ? (
        <DashboardView
          activity={activity}
          commitCount={commitCount}
          error={error}
          githubAuthor={githubAuthor}
          history={history}
          loading={loading}
          onCopy={() => navigator.clipboard.writeText(summary)}
          onDeleteHistory={deleteHistoryEntry}
          onGenerate={generateTodayWorklog}
          onInspect={inspectActivity}
          onOpenSettings={() => setView("settings")}
          onRestoreHistory={restoreHistoryEntry}
          onWorkDateChange={setWorkDate}
          pullRequestCount={pullRequestCount}
          selectedRepos={selectedRepos}
          setupComplete={setupComplete}
          sheetStatus={sheetStatus}
          showActivity={showActivity}
          style={style}
          summary={summary}
          workDate={workDate}
        />
      ) : (
        <SettingsView {...sharedSettings} />
      )}
    </AppShell>
  );
}
