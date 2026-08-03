"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "./components/AppShell";
import { DashboardView } from "./components/DashboardView";
import { SettingsView } from "./components/SettingsView";
import { HistoryView } from "./components/HistoryView";
import { AuditView } from "./components/AuditView";
import { FirstRunWizard } from "./components/FirstRunWizard";
import { createHistoryEntry } from "../lib/worklogHistory.mjs";
import { enumerateDates, localDateAt } from "../lib/localDate.mjs";
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
  const [commitExclusions, setCommitExclusions] = useState("");
  const [repoFilters, setRepoFilters] = useState({});
  const [githubAuthors, setGithubAuthors] = useState([]);
  const [googleSheetLink, setGoogleSheetLink] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [googleSheetTab, setGoogleSheetTab] = useState("Sheet1");
  const [googleSheetTabs, setGoogleSheetTabs] = useState([]);
  const [defaultHours, setDefaultHours] = useState("8");
  const [sheetMapping, setSheetMapping] = useState({ date: "A", summary: "B", hours: "D", reference: "" });
  const [googleConnected, setGoogleConnected] = useState(false);
  const [sheetStatus, setSheetStatus] = useState("");
  const [repos, setRepos] = useState([]);
  const [selectedRepos, setSelectedRepos] = useState([]);
  const [activitySource, setActivitySource] = useState("github");
  const [localRepositories, setLocalRepositories] = useState([]);
  const [localRepoMessage, setLocalRepoMessage] = useState("");
  const [workDate, setWorkDate] = useState(() => localDateAt());
  const [rangeEnabled, setRangeEnabled] = useState(false);
  const [rangeStart, setRangeStart] = useState(() => localDateAt());
  const [rangeEnd, setRangeEnd] = useState(() => localDateAt());
  const [style, setStyle] = useState("standup");
  const [summaryPreference, setSummaryPreference] = useState("");
  const [theme, setTheme] = useState("dark");
  const [activity, setActivity] = useState("");
  const [commitCount, setCommitCount] = useState(0);
  const [pullRequestCount, setPullRequestCount] = useState(0);
  const [summary, setSummary] = useState("");
  const [rangeDrafts, setRangeDrafts] = useState([]);
  const [rangeWritePrompt, setRangeWritePrompt] = useState(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState("");
  const [githubLoading, setGithubLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [view, setView] = useState("dashboard");
  const [historyQuery, setHistoryQuery] = useState("");
  const [deletedHistory, setDeletedHistory] = useState(null);
  const [showActivity, setShowActivity] = useState(false);
  const [automation, setAutomation] = useState({
    enabled: false,
    time: "17:30",
    days: [1, 2, 3, 4, 5],
    startAtLogin: false,
  });
  const [automationStatus, setAutomationStatus] = useState({});
  const [automationBusy, setAutomationBusy] = useState(false);
  const [automationMessage, setAutomationMessage] = useState("");
  const [healthChecks, setHealthChecks] = useState([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateProgress, setUpdateProgress] = useState(null);
  const [wizardStep, setWizardStep] = useState(0);
  // Read after mount, not in the initializer — localStorage is unavailable during
  // the server render and a mismatch here breaks hydration.
  const [wizardDismissed, setWizardDismissed] = useState(true);
  const requestIdRef = useRef(0);
  const initializedRef = useRef(false);
  const suppressResetRef = useRef(false);

  const sourceComplete = activitySource === "local"
    ? localRepositories.length > 0
    : githubToken && githubAuthor && selectedRepos.length;
  const setupComplete = Boolean(geminiApiKey && sourceComplete);
  const desktopAvailable = typeof window !== "undefined" &&
    Boolean(window.worklogDesktop?.runAutomation);
  const automationReady = Boolean(
    desktopAvailable && setupComplete && googleConnected && googleSheetLink,
  );
  const automationUnavailableMessage = !desktopAvailable
    ? "Desktop app required to test automation."
    : !setupComplete
      ? `Complete ${activitySource === "local" ? "Local Git" : "GitHub"} and Gemini setup before enabling automation.`
      : !googleConnected || !googleSheetLink
        ? "Connect Google Sheets before enabling automation."
        : "";
  const currentInputKey = activityInputKey({
    workDate,
    githubAuthor,
    githubToken,
    selectedRepos,
    activitySource,
    localRepositories,
  });

  useEffect(() => {
    setWizardDismissed(localStorage.getItem("worklog-wizard-dismissed") === "1");
  }, []);

  useEffect(() => {
    const listener = window.worklogDesktop?.onUpdateAvailable;
    if (listener) listener(setUpdateInfo);
    const progressListener = window.worklogDesktop?.onUpdateProgress;
    if (progressListener) progressListener(setUpdateProgress);
    const downloadedListener = window.worklogDesktop?.onUpdateDownloaded;
    if (downloadedListener) downloadedListener(() => setUpdateProgress({ downloaded: true }));
  }, []);

  useEffect(() => {
    async function loadLocalData() {
      const [settingsResponse, historyResponse, automationResponse] = await Promise.all([
        fetch("/api/local/settings"),
        fetch("/api/local/history"),
        fetch("/api/automation/settings"),
      ]);

      if (settingsResponse.ok) {
        const { settings } = await settingsResponse.json();
        setGeminiApiKey(settings.geminiApiKey || "");
        setGithubToken(settings.githubToken || "");
        setGithubAuthor(settings.githubAuthor || "");
        setCommitExclusions(settings.commitExclusions || "");
        setRepoFilters(settings.repoFilters || {});
        setGoogleSheetLink(settings.googleSheetLink || "");
        setGoogleClientId(settings.googleClientId || "");
        setGoogleClientSecret(settings.googleClientSecret || "");
        setGoogleSheetTab(settings.googleSheetTab || "Sheet1");
        setDefaultHours(settings.defaultHours || "8");
        setSheetMapping({ date: settings.googleDateColumn || "A", summary: settings.googleSummaryColumn || "B", hours: settings.googleHoursColumn || "D", reference: settings.googleReferenceColumn || "" });
        setStyle(settings.style === "timesheet" ? "sheet-cell" : settings.style || "standup");
        setSummaryPreference(settings.summaryPreference || "");
        setTheme(settings.theme || "dark");
        setSelectedRepos(settings.selectedRepos || []);
        setActivitySource(settings.activitySource || "github");
        setLocalRepositories(settings.localRepositories || []);
        if (settings.githubToken) {
          void loadAuthors(settings.selectedRepos || [], settings.githubToken);
        }
      }

      if (historyResponse.ok) {
        const { history: savedHistory } = await historyResponse.json();
        setHistory(savedHistory);
      }

      if (automationResponse.ok) {
        const data = await automationResponse.json();
        setAutomation((current) => ({ ...current, ...data.settings }));
        setAutomationStatus(data.status || {});
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

  // Held in a ref so the listener is bound once instead of re-subscribing on
  // every render (generateTodayWorklog is a new function each time).
  const shortcutRef = useRef({ generate: generateTodayWorklog, summary });
  shortcutRef.current = { generate: generateTodayWorklog, summary };

  useEffect(() => {
    function onShortcut(event) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.target?.closest?.("input, textarea, select")) return;
      const { generate, summary: currentSummary } = shortcutRef.current;
      if (event.key === "Enter") { event.preventDefault(); void generate(); }
      if (event.key.toLowerCase() === "c" && event.shiftKey && currentSummary) {
        event.preventDefault();
        void navigator.clipboard.writeText(currentSummary);
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
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
    setWarning("");
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

  async function loadGoogleTabs() {
    const response = await fetch("/api/google/tabs");
    const data = await response.json();
    if (response.ok) { setGoogleSheetTabs(data.tabs); if (!data.tabs.includes(googleSheetTab) && data.tabs[0]) { setGoogleSheetTab(data.tabs[0]); void saveSettings({ googleSheetTab: data.tabs[0] }); } }
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
          googleDateColumn: sheetMapping.date,
          googleSummaryColumn: sheetMapping.summary,
          googleHoursColumn: sheetMapping.hours,
          googleReferenceColumn: sheetMapping.reference,
          style,
          summaryPreference,
          theme,
          selectedRepos,
          activitySource,
          localRepositories,
          repoFilters,
          commitExclusions,
          ...nextSettings,
        },
      }),
    });
  }

  async function saveAutomation(patch) {
    setAutomationBusy(true);
    setAutomationMessage("");
    try {
      let data;
      if (window.worklogDesktop?.saveAutomationSettings) {
        data = await window.worklogDesktop.saveAutomationSettings(patch);
      } else {
        const response = await fetch("/api/automation/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not save automation.");
      }
      setAutomation((current) => ({ ...current, ...data.settings }));
      setAutomationStatus(data.status || {});
      setAutomationMessage("Automation settings saved.");
    } catch (nextError) {
      setAutomationMessage(nextError.message || "Could not save automation.");
    } finally {
      setAutomationBusy(false);
    }
  }

  async function runAutomationNow() {
    if (!window.worklogDesktop?.runAutomation) {
      setAutomationMessage("Desktop app required to test automation.");
      return;
    }
    setAutomationBusy(true);
    setAutomationMessage("Generating today's worklog...");
    try {
      const result = await window.worklogDesktop.runAutomation();
      setAutomationMessage(
        result?.status === "success"
          ? "Worklog written to Google Sheets."
          : result?.status === "no_activity"
            ? "No GitHub activity found today."
            : result?.error || "Automation finished.",
      );
      const data = await window.worklogDesktop.getAutomationStatus();
      setAutomationStatus(data.status || {});
      const historyResponse = await fetch("/api/local/history");
      if (historyResponse.ok) {
        const { history: savedHistory } = await historyResponse.json();
        setHistory(savedHistory);
      }
    } catch (nextError) {
      setAutomationMessage(nextError.message || "Automatic worklog failed.");
    } finally {
      setAutomationBusy(false);
    }
  }

  async function runHealthCheck() {
    setHealthLoading(true);
    try {
      const response = await fetch("/api/setup/health");
      const data = await response.json();
      setHealthChecks(data.checks || []);
    } catch (nextError) {
      setHealthChecks([{ id: "app", label: "App", status: "fail", message: nextError.message || "Could not run setup check." }]);
    } finally {
      setHealthLoading(false);
    }
  }

  async function loadRepos() {
    setGithubLoading(true);
    setError("");
    setWarning("");
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

  async function addLocalRepository() {
    setLocalRepoMessage("");
    if (!window.worklogDesktop?.chooseLocalRepository) {
      setLocalRepoMessage("Local repositories can only be added in the desktop app.");
      return;
    }
    try {
      setLocalRepoMessage("Choose a repository folder...");
      const selectedPath = await window.worklogDesktop.chooseLocalRepository();
      if (!selectedPath) {
        setLocalRepoMessage("");
        return;
      }
      setLocalRepoMessage("Checking repository...");
      const repository = await window.worklogDesktop.inspectLocalRepository(selectedPath);
      const next = [
        ...localRepositories.filter((item) => item.path !== repository.path),
        repository,
      ];
      setLocalRepositories(next);
      await saveSettings({ localRepositories: next });
      setLocalRepoMessage(`${repository.displayName} added.`);
    } catch (nextError) {
      setLocalRepoMessage(nextError.message || "Could not add local repository.");
    }
  }

  function removeLocalRepository(id) {
    const next = localRepositories.filter((repo) => repo.id !== id);
    setLocalRepositories(next);
    void saveSettings({ localRepositories: next });
  }

  function updateLocalRepository(id, patch) {
    const next = localRepositories.map((repo) =>
      repo.id === id ? { ...repo, ...patch } : repo);
    setLocalRepositories(next);
    void saveSettings({ localRepositories: next });
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
        activitySource,
        localRepositories,
        excludeCommitPatterns: commitExclusions,
        repoFilters,
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
        activitySource,
        localRepositories,
        activitySource,
        localRepositories,
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
    setWarning((data.warnings || []).join(" "));
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
        preference: summaryPreference,
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
        activitySource,
        localRepositories,
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
    const saved = await saveHistoryFor(workDate, activityResult, data.summary);
    if (requestIdRef.current !== started.requestId) return;
    if (saved) setHistory(saved);
    await saveSettings();
    if (requestIdRef.current !== started.requestId) return;
  }

  async function saveHistoryFor(date, activityResult, nextSummary) {
    const entry = createHistoryEntry({
      workDate: date,
      style,
      selectedRepos: activitySource === "local"
        ? localRepositories.map((repo) => repo.displayName)
        : selectedRepos,
      activity: activityResult.activity,
      summary: nextSummary,
      commitCount: activityResult.commitCount || 0,
      pullRequestCount: activityResult.pullRequestCount || 0,
      activitySource,
    });
    const response = await fetch("/api/local/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry }),
    });
    if (!response.ok) return null;
    const { history: savedHistory } = await response.json();
    setHistory(savedHistory);
    return savedHistory;
  }

  async function generateTodayWorklog() {
    if (rangeEnabled) return generateDateRange();
    const result = await fetchGithubActivity();
    if (!result) return;
    if (!hasWorkActivity(result)) {
      setShowActivity(true);
      setError(
        activitySource === "local"
          ? "No matching local commits were found for the selected date."
          : "No commits or pull requests were found for the selected date.",
      );
      return;
    }
    await generateSummaryFromActivity(result);
  }

  async function generateDateRange() {
    if (rangeStart > rangeEnd) { setError("Start date must be before end date."); return; }
    setLoading("range"); setError(""); setSheetStatus("");
    const dates = enumerateDates(rangeStart, rangeEnd);
    const drafts = [];
    for (const date of dates) {
      const activityResponse = await fetch("/api/github/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ githubToken, repoFullNames: selectedRepos, date, author: githubAuthor, activitySource, localRepositories, excludeCommitPatterns: commitExclusions, repoFilters }) });
      const activityData = await activityResponse.json();
      if (!activityResponse.ok) { setError(activityData.error || `Could not fetch ${date}.`); break; }
      if (!hasWorkActivity(activityData)) continue;
      const summaryResponse = await fetch("/api/generate-summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ geminiApiKey, workDate: date, style, preference: summaryPreference, activity: activityData.activity }) });
      const summaryData = await summaryResponse.json();
      if (!summaryResponse.ok) { setError(summaryData.error || `Could not summarize ${date}.`); break; }
      drafts.push({ date, summary: summaryData.summary, selected: true });
      await saveHistoryFor(date, activityData, summaryData.summary);
      setWorkDate(date); setSummary(summaryData.summary); setActivity(activityData.activity); setCommitCount(activityData.commitCount || 0); setPullRequestCount(activityData.pullRequestCount || 0);
    }
    const checkResponse = await fetch("/api/google/check-dates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dates: drafts.map((draft) => draft.date) }) });
    if (checkResponse.ok) {
      const { rows } = await checkResponse.json();
      drafts.forEach((draft) => { draft.existing = Boolean(rows[draft.date]); draft.selected = !draft.existing; });
    }
    setRangeDrafts(drafts);
    setLoading("");
    setSheetStatus(`${drafts.length} day${drafts.length === 1 ? "" : "s"} ready for review.`);
  }

  async function writeRangeDrafts() {
    const selected = rangeDrafts.filter((draft) => draft.selected);
    const existing = selected.filter((draft) => draft.existing);
    if (!selected.length) { setSheetStatus("Select at least one day to write."); return; }
    if (existing.length) { setRangeWritePrompt({ selected, existing }); return; }
    await performRangeWrite(selected);
  }

  async function performRangeWrite(selected) {
    setRangeWritePrompt(null); setLoading("range-write");
    for (const draft of selected) await writeSummaryToSheet(draft.summary, draft.date);
    setLoading("");
    setSheetStatus(`${selected.length} day${selected.length === 1 ? "" : "s"} written to Google Sheets.`);
  }

  async function inspectActivity() {
    await fetchGithubActivity({ reveal: true });
  }

  async function connectGoogle() {
    setError("");
    setWarning("");
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

  async function writeSummaryToSheet(nextSummary, targetDate = workDate) {
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
      body: JSON.stringify({
        workDate: targetDate,
        summary: nextSummary,
        reference: activitySource === "local"
          ? localRepositories.map((repo) => repo.displayName).join(", ")
          : selectedRepos.join(", "),
      }),
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
        activitySource,
        localRepositories,
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
    const removed = history.find((entry) => entry.id === entryId);
    const response = await fetch("/api/local/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entryId }),
    });
    if (response.ok) {
      const { history: savedHistory } = await response.json();
      setHistory(savedHistory);
      setDeletedHistory(removed || null);
    }
  }

  async function undoDeleteHistory() {
    if (!deletedHistory) return;
    const response = await fetch("/api/local/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry: deletedHistory }) });
    if (response.ok) { const { history: savedHistory } = await response.json(); setHistory(savedHistory); setDeletedHistory(null); }
  }

  function changeTheme(nextTheme) {
    setTheme(nextTheme);
    void saveSettings({ theme: nextTheme });
  }

  const sharedSettings = {
    available: automationReady,
    automation,
    automationBusy,
    automationMessage,
    automationStatus,
    automationUnavailableMessage,
    defaultHours,
    sheetMapping,
    geminiApiKey,
    githubAuthor,
    commitExclusions,
    githubAuthors,
    githubLoading,
    githubToken,
    activitySource,
    localRepositories,
    localRepoMessage,
    googleClientId,
    googleClientSecret,
    googleConnected,
    googleSheetLink,
    googleSheetTab,
    googleSheetTabs,
    healthChecks,
    healthLoading,
    onAuthorChange: (value) => { setGithubAuthor(value); void saveSettings({ githubAuthor: value }); },
    onCommitExclusionsChange: (value) => { setCommitExclusions(value); void saveSettings({ commitExclusions: value }); },
    repoFilters,
    onRepoFilterChange: (repo, value) => { const next = { ...repoFilters, [repo]: value }; setRepoFilters(next); void saveSettings({ repoFilters: next }); },
    onChange: saveAutomation,
    onConnectGoogle: connectGoogle,
    onDefaultHoursChange: setDefaultHours,
    onSheetMappingChange: (patch) => { const next = { ...sheetMapping, ...patch }; setSheetMapping(next); void saveSettings({ googleDateColumn: next.date, googleSummaryColumn: next.summary, googleHoursColumn: next.hours, googleReferenceColumn: next.reference }); },
    onGeminiApiKeyChange: setGeminiApiKey,
    onGithubTokenChange: setGithubToken,
    onGoogleClientIdChange: setGoogleClientId,
    onGoogleClientSecretChange: setGoogleClientSecret,
    onGoogleSheetLinkChange: setGoogleSheetLink,
    onGoogleSheetTabChange: setGoogleSheetTab,
    onLoadGoogleTabs: loadGoogleTabs,
    onLoadRepos: loadRepos,
    onAddLocalRepository: addLocalRepository,
    onActivitySourceChange: (value) => {
      setActivitySource(value);
      void saveSettings({ activitySource: value });
    },
    onRemoveLocalRepository: removeLocalRepository,
    onUpdateLocalRepository: updateLocalRepository,
    onRunNow: runAutomationNow,
    onRunHealthCheck: runHealthCheck,
    onSave: saveSettings,
    onStyleChange: setStyle,
    onSummaryPreferenceChange: (value) => { setSummaryPreference(value); void saveSettings({ summaryPreference: value }); },
    onThemeChange: changeTheme,
    onToggleRepo: toggleRepo,
    repos,
    selectedRepos,
    sheetStatus,
    style,
    summaryPreference,
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
      updateInfo={updateInfo}
      updateProgress={updateProgress}
      onDownloadUpdate={() => window.worklogDesktop?.downloadUpdate()}
      onInstallUpdate={() => window.worklogDesktop?.installUpdate()}
      view={view}
      overlay={!wizardDismissed && !setupComplete ? <FirstRunWizard step={wizardStep} onStepChange={setWizardStep} onOpenSettings={(section) => { setWizardDismissed(true); setView("settings"); if (section === "health") void runHealthCheck(); }} onDismiss={() => { localStorage.setItem("worklog-wizard-dismissed", "1"); setWizardDismissed(true); }} /> : null}
      historyCount={history.length}
    >
      {view === "dashboard" ? (
        <DashboardView
          activity={activity}
          commitCount={commitCount}
          error={error}
          warning={warning}
          githubAuthor={githubAuthor}
          activitySource={activitySource}
          history={history}
          loading={loading}
          onCopy={() => navigator.clipboard.writeText(summary)}
          onSummaryChange={setSummary}
          onWriteSummary={() => writeSummaryToSheet(summary)}
          rangeEnabled={rangeEnabled}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onRangeEnabledChange={setRangeEnabled}
          onRangeStartChange={setRangeStart}
          onRangeEndChange={setRangeEnd}
          rangeDrafts={rangeDrafts}
          onRangeDraftChange={(date, patch) => setRangeDrafts((current) => current.map((draft) => draft.date === date ? { ...draft, ...patch } : draft))}
          onWriteRange={writeRangeDrafts}
          rangeWritePrompt={rangeWritePrompt}
          onConfirmRangeWrite={performRangeWrite}
          onCancelRangeWrite={() => setRangeWritePrompt(null)}
          onDeleteHistory={deleteHistoryEntry}
          onGenerate={generateTodayWorklog}
          onInspect={inspectActivity}
          onOpenSettings={() => setView("settings")}
          onRestoreHistory={restoreHistoryEntry}
          onWorkDateChange={setWorkDate}
          pullRequestCount={pullRequestCount}
          selectedRepos={selectedRepos}
          localRepositories={localRepositories}
          setupComplete={setupComplete}
          sheetStatus={sheetStatus}
          showActivity={showActivity}
          style={style}
          summary={summary}
          workDate={workDate}
        />
      ) : view === "history" ? (
        <HistoryView history={history} query={historyQuery} deletedHistory={deletedHistory} onQueryChange={setHistoryQuery} onDelete={deleteHistoryEntry} onUndoDelete={undoDeleteHistory} onRestore={(entry) => { restoreHistoryEntry(entry); setView("dashboard"); }} />
      ) : view === "audit" ? <AuditView /> : (
        <SettingsView {...sharedSettings} />
      )}
    </AppShell>
  );
}
