"use client";

import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  GitFork,
  KeyRound,
  MonitorCog,
  RefreshCw,
  Sparkles,
  Table2,
} from "lucide-react";
import { useState } from "react";
import { PageHeader } from "./DashboardView";
import { AutomationSection } from "./AutomationSection";

const sections = [
  { id: "credentials", label: "Credentials", icon: KeyRound },
  { id: "github", label: "GitHub", icon: GitFork },
  { id: "google", label: "Google Sheets", icon: Table2 },
  { id: "automation", label: "Automation", icon: Clock3 },
  { id: "output", label: "Output", icon: Sparkles },
  { id: "appearance", label: "Appearance", icon: MonitorCog },
];

export function SettingsView(props) {
  const [section, setSection] = useState("credentials");

  return (
    <>
      <PageHeader
        eyebrow="Settings / Local configuration"
        title="Settings"
        subtitle="Connect once, then return only when something changes."
      />
      <div className="page-scroll">
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            <p className="nav-label">Sections</p>
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                className={section === id ? "active" : ""}
                key={id}
                type="button"
                onClick={() => setSection(id)}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {section === "credentials" && <CredentialsSection {...props} />}
            {section === "github" && <GithubSection {...props} />}
            {section === "google" && <GoogleSection {...props} />}
            {section === "automation" && <AutomationSection {...props} />}
            {section === "output" && <OutputSection {...props} />}
            {section === "appearance" && <AppearanceSection {...props} />}
          </div>
        </div>
      </div>
    </>
  );
}

function SettingsPanel({ children, description, title }) {
  return (
    <section className="panel settings-panel">
      <header className="settings-panel-header">
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      <div className="settings-fields">{children}</div>
    </section>
  );
}

function CredentialsSection({
  geminiApiKey,
  githubToken,
  onGeminiApiKeyChange,
  onGithubTokenChange,
  onSave,
}) {
  return (
    <SettingsPanel title="Credentials" description="Stored locally in SQLite and never included in summaries.">
      <SettingsField label="GitHub fine-grained token" hint="Used to read repositories, commits, and pull requests.">
        <input
          type="password"
          value={githubToken}
          placeholder="Paste token here"
          autoComplete="off"
          onChange={(event) => onGithubTokenChange(event.target.value)}
          onBlur={() => onSave({ githubToken })}
        />
      </SettingsField>
      <SettingsField label="Gemini API key" hint="Used only when generating a worklog summary.">
        <input
          type="password"
          value={geminiApiKey}
          placeholder="Paste key from Google AI Studio"
          autoComplete="off"
          onChange={(event) => onGeminiApiKeyChange(event.target.value)}
          onBlur={() => onSave({ geminiApiKey })}
        />
      </SettingsField>
    </SettingsPanel>
  );
}

function GithubSection({
  githubAuthor,
  githubAuthors,
  githubLoading,
  githubToken,
  onAuthorChange,
  onLoadRepos,
  onToggleRepo,
  repos,
  selectedRepos,
}) {
  return (
    <SettingsPanel title="GitHub" description="Choose your identity and the repositories included in each worklog.">
      <SettingsField label="GitHub commit author" hint="Filters shared repositories to your own commits and pull requests.">
        <SelectWrap>
          <select value={githubAuthor} onChange={(event) => onAuthorChange(event.target.value)}>
            <option value="">Select author</option>
            {githubAuthors.map((author) => <option key={author.value} value={author.value}>{author.label}</option>)}
            {githubAuthor && !githubAuthors.some((author) => author.value === githubAuthor) && (
              <option value={githubAuthor}>{githubAuthor}</option>
            )}
          </select>
        </SelectWrap>
      </SettingsField>

      <div className="settings-action-row">
        <div><strong>Repositories</strong><span>Load accessible repositories, then select what to monitor.</span></div>
        <button className="secondary-button" disabled={!githubToken || githubLoading} type="button" onClick={onLoadRepos}>
          <RefreshCw className={githubLoading ? "spin" : ""} size={15} />
          {githubLoading ? "Loading" : "Load Repos"}
        </button>
      </div>

      <div className="repo-list redesigned">
        {!repos.length && <p className="settings-empty">No repositories loaded.</p>}
        {repos.map((repo) => (
          <label className="repo-option" key={repo.id}>
            <input
              type="checkbox"
              checked={selectedRepos.includes(repo.fullName)}
              onChange={() => onToggleRepo(repo.fullName)}
            />
            <span>{repo.fullName}</span>
          </label>
        ))}
      </div>
    </SettingsPanel>
  );
}

function GoogleSection({
  defaultHours,
  googleClientId,
  googleClientSecret,
  googleConnected,
  googleSheetLink,
  googleSheetTab,
  onConnectGoogle,
  onDefaultHoursChange,
  onGoogleClientIdChange,
  onGoogleClientSecretChange,
  onGoogleSheetLinkChange,
  onGoogleSheetTabChange,
  onSave,
  sheetStatus,
}) {
  return (
    <SettingsPanel title="Google Sheets" description="Write every generated summary into the current office worklog sheet.">
      <div className={`connection-banner ${googleConnected ? "connected" : ""}`}>
        <CheckCircle2 size={16} />
        <span>{googleConnected ? "Google account connected" : "Google account not connected"}</span>
      </div>
      <div className="field-grid">
        <SettingsField label="Google Client ID">
          <input value={googleClientId} placeholder="OAuth client ID" onChange={(e) => onGoogleClientIdChange(e.target.value)} onBlur={() => onSave({ googleClientId })} />
        </SettingsField>
        <SettingsField label="Google Client Secret">
          <input type="password" value={googleClientSecret} placeholder="OAuth client secret" onChange={(e) => onGoogleClientSecretChange(e.target.value)} onBlur={() => onSave({ googleClientSecret })} />
        </SettingsField>
      </div>
      <SettingsField label="Current month sheet link" hint="Update this when your office starts a new monthly sheet.">
        <input value={googleSheetLink} placeholder="https://docs.google.com/spreadsheets/d/..." onChange={(e) => onGoogleSheetLinkChange(e.target.value)} onBlur={() => onSave({ googleSheetLink })} />
      </SettingsField>
      <div className="field-grid compact">
        <SettingsField label="Sheet tab">
          <input value={googleSheetTab} placeholder="Sheet1" onChange={(e) => onGoogleSheetTabChange(e.target.value)} onBlur={() => onSave({ googleSheetTab })} />
        </SettingsField>
        <SettingsField label="Default hours">
          <input value={defaultHours} inputMode="decimal" placeholder="8" onChange={(e) => onDefaultHoursChange(e.target.value)} onBlur={() => onSave({ defaultHours })} />
        </SettingsField>
      </div>
      <button className="primary-action settings-connect" disabled={!googleClientId || !googleClientSecret} type="button" onClick={onConnectGoogle}>
        {googleConnected ? "Reconnect Google" : "Connect Google"}
      </button>
      {sheetStatus && <p className="settings-status">{sheetStatus}</p>}
    </SettingsPanel>
  );
}

function OutputSection({ onSave, onStyleChange, style }) {
  return (
    <SettingsPanel title="Output" description="Choose how Gemini formats the generated office update.">
      <SettingsField label="Summary style" hint="Sheet cell is the simplest option for one-cell worklogs.">
        <SelectWrap>
          <select value={style} onChange={(event) => { onStyleChange(event.target.value); onSave({ style: event.target.value }); }}>
            <option value="standup">Standup</option>
            <option value="concise">Concise</option>
            <option value="detailed">Detailed</option>
            <option value="sheet-cell">Sheet cell</option>
            <option value="time-wise">Time-wise</option>
            <option value="bullet-points">Bullet points</option>
          </select>
        </SelectWrap>
      </SettingsField>
    </SettingsPanel>
  );
}

function AppearanceSection({ onThemeChange, theme }) {
  return (
    <SettingsPanel title="Appearance" description="The selected theme is saved locally for future launches.">
      <div className="appearance-options">
        <button className={theme === "dark" ? "active" : ""} type="button" onClick={() => onThemeChange("dark")}>
          <span className="theme-preview dark-preview" />
          <strong>Dark</strong>
        </button>
        <button className={theme === "light" ? "active" : ""} type="button" onClick={() => onThemeChange("light")}>
          <span className="theme-preview light-preview" />
          <strong>Light</strong>
        </button>
      </div>
    </SettingsPanel>
  );
}

function SettingsField({ children, hint, label }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function SelectWrap({ children }) {
  return <span className="select-wrap">{children}<ChevronDown size={15} /></span>;
}
