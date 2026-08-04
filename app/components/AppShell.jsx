"use client";

import {
  LayoutDashboard,
  Moon,
  Settings,
  History,
  ClipboardList,
  CalendarSearch,
  Sun,
} from "lucide-react";

export function AppShell({
  children,
  githubConnected,
  googleConnected,
  navigationDisabled,
  onThemeChange,
  onViewChange,
  theme,
  view,
  historyCount,
  updateInfo,
  onDownloadUpdate,
  updateProgress,
  onInstallUpdate,
  onOpenUpdateDownload,
  overlay,
}) {
  return (
    <main className="app-shell" data-theme={theme}>
      <header className="product-bar">
        <div className="product-identity">
          <span className="product-mark">W</span>
          <span>AI Worklog Agent</span>
          <span className="local-badge">LOCAL</span>
        </div>
      </header>

      {updateInfo && <div className="update-banner">{updateInfo.canInstall === false ? <>Version {updateInfo.version} available. This Mac build cannot update itself, so it must be downloaded and installed by hand. <button type="button" onClick={onOpenUpdateDownload}>Open download page</button></> : updateProgress?.error ? <>{updateProgress.error} <button type="button" onClick={onDownloadUpdate}>Try again</button></> : updateProgress?.downloaded ? <>Version {updateInfo.version} ready <button type="button" onClick={onInstallUpdate}>Restart to install</button></> : updateProgress?.percent != null ? <>Downloading update... {updateProgress.percent}%</> : <>Version {updateInfo.version} available <button type="button" onClick={onDownloadUpdate}>Download update</button></>}</div>}
      <div className="app-frame">
        <aside className="sidebar">
          <p className="nav-label">Navigation</p>
          <nav className="primary-nav" aria-label="Application">
            <button
              className={view === "dashboard" ? "active" : ""}
              disabled={navigationDisabled}
              type="button"
              onClick={() => onViewChange("dashboard")}
            >
              <LayoutDashboard size={17} />
              <span>Dashboard</span>
            </button>
            <button className={view === "history" ? "active" : ""} disabled={navigationDisabled} type="button" onClick={() => onViewChange("history")}><History size={17} /><span>History{historyCount ? ` (${historyCount})` : ""}</span></button>
            <button className={view === "audit" ? "active" : ""} disabled={navigationDisabled} type="button" onClick={() => onViewChange("audit")}><ClipboardList size={17} /><span>Sheet audit</span></button>
            <button className={view === "missing" ? "active" : ""} disabled={navigationDisabled} type="button" onClick={() => onViewChange("missing")}><CalendarSearch size={17} /><span>Missing days</span></button>
            <button
              className={view === "settings" ? "active" : ""}
              disabled={navigationDisabled}
              type="button"
              onClick={() => onViewChange("settings")}
            >
              <Settings size={17} />
              <span>Settings</span>
            </button>
          </nav>

          <div className="sidebar-spacer" />

          <div className="connection-card">
            <ConnectionStatus
              connected={googleConnected}
              label={googleConnected ? "Google connected" : "Google not connected"}
            />
            <ConnectionStatus
              connected={githubConnected}
              label={githubConnected ? "GitHub token saved" : "GitHub not configured"}
            />
          </div>

          <div className="sidebar-theme" aria-label="Theme">
            <button
              className={theme === "dark" ? "active" : ""}
              aria-label="Use dark theme"
              title="Dark"
              type="button"
              onClick={() => onThemeChange("dark")}
            >
              <Moon size={15} />
              <span>Dark</span>
            </button>
            <button
              className={theme === "light" ? "active" : ""}
              aria-label="Use light theme"
              title="Light"
              type="button"
              onClick={() => onThemeChange("light")}
            >
              <Sun size={15} />
              <span>Light</span>
            </button>
          </div>
        </aside>

        <section className="main-surface">{children}</section>
      </div>
      {overlay}
    </main>
  );
}

function ConnectionStatus({ connected, label }) {
  return (
    <div className="connection-status">
      <span className={connected ? "status-dot connected" : "status-dot"} />
      <span>{label}</span>
    </div>
  );
}
