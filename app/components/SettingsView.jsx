"use client";

import {
  CheckCircle2,
  ChevronDown,
  Clock3,
  FolderGit2,
  GitFork,
  KeyRound,
  MonitorCog,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { PageHeader } from "./DashboardView";
import { AutomationSection } from "./AutomationSection";

const sections = [
  { id: "health", label: "Setup check", icon: ShieldCheck },
  { id: "credentials", label: "Credentials", icon: KeyRound },
  { id: "github", label: "Git activity", icon: GitFork },
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
            {section === "health" && <HealthCheckSection {...props} />}
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

function HealthCheckSection({ healthChecks, healthLoading, onRunHealthCheck }) {
  return (
    <SettingsPanel title="Setup check" description="Test connections before generating or scheduling a worklog.">
      <div className="settings-action-row">
        <div><strong>Connection diagnostics</strong><span>Checks selected activity source, Gemini, and Google Sheets access.</span></div>
        <button className="secondary-button" type="button" disabled={healthLoading} onClick={onRunHealthCheck}>
          <RefreshCw className={healthLoading ? "spin" : ""} size={15} />
          {healthLoading ? "Checking" : "Run check"}
        </button>
      </div>
      {healthChecks?.length ? (
        <div className="health-check-list">
          {healthChecks.map((item) => (
            <div className={`health-check-item ${item.status}`} key={item.id}>
              <span className="health-check-icon" aria-hidden="true">{item.status === "pass" ? "✓" : item.status === "skip" ? "-" : "!"}</span>
              <div><strong>{item.label}</strong><span>{item.message}</span></div>
            </div>
          ))}
        </div>
      ) : <p className="settings-empty">Run a check after entering your setup details.</p>}
    </SettingsPanel>
  );
}

function CredentialsSection({
  activitySource,
  geminiApiKey,
  githubToken,
  onGeminiApiKeyChange,
  onGithubTokenChange,
  onSave,
}) {
  return (
    <SettingsPanel title="Credentials" description="Stored locally and encrypted on desktop. Never included in summaries.">
      {activitySource === "github" && (
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
      )}
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
  commitExclusions,
  onCommitExclusionsChange,
  repoFilters,
  onRepoFilterChange,
  activitySource,
  githubAuthor,
  githubAuthors,
  githubLoading,
  githubToken,
  localRepositories,
  localRepoMessage,
  onActivitySourceChange,
  onAddLocalRepository,
  onAuthorChange,
  onLoadRepos,
  onRemoveLocalRepository,
  onToggleRepo,
  onUpdateLocalRepository,
  repos,
  selectedRepos,
}) {
  return (
    <SettingsPanel title="Git activity" description="Choose one source for commits included in each worklog.">
      <div className="source-selector" role="group" aria-label="Activity source">
        <button className={activitySource === "github" ? "active" : ""} type="button" onClick={() => onActivitySourceChange("github")}>GitHub</button>
        <button className={activitySource === "local" ? "active" : ""} type="button" onClick={() => onActivitySourceChange("local")}>Local repositories</button>
      </div>

      {activitySource === "local" ? (
        <>
          <div className="settings-action-row">
            <div><strong>Local repositories</strong><span>Committed work from all local branches. Working-tree changes are ignored.</span></div>
            <button className="secondary-button" type="button" onClick={onAddLocalRepository}>
              <FolderGit2 size={15} />
              Add repository
            </button>
          </div>
          <div className="local-repo-list">
            {!localRepositories.length && <p className="settings-empty">No local repositories selected.</p>}
            {localRepositories.map((repo) => (
              <article className="local-repo-item" key={repo.id}>
                <div className="local-repo-heading">
                  <div><strong>{repo.displayName}</strong><span>{repo.path}</span></div>
                  <button className="icon-button" title="Remove repository" type="button" onClick={() => onRemoveLocalRepository(repo.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="field-grid local-identity-grid">
                  <SettingsField label="Detected Git identity">
                    <input readOnly value={[repo.detectedName, repo.detectedEmail].filter(Boolean).join(" / ")} />
                  </SettingsField>
                  <SettingsField label="Additional author emails" hint="Comma-separated older or alternate account emails.">
                    <input
                      value={(repo.acceptedEmails || []).join(", ")}
                      placeholder="name@company.com"
                      onChange={(event) => onUpdateLocalRepository(repo.id, {
                        acceptedEmails: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                      })}
                    />
                  </SettingsField>
                </div>
              </article>
            ))}
          </div>
          {localRepoMessage && (
            <p className="settings-status" role="status">{localRepoMessage}</p>
          )}
        </>
      ) : (
        <>
      <SettingsField label="GitHub commit author" hint="Filters shared repositories to your own commits and pull requests. GitHub activity reads the repository's default branch.">
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
      <SettingsField label="Exclude commit messages" hint="Comma-separated words. Matching commits are ignored.">
        <input value={commitExclusions} placeholder="merge, bump version" onChange={(event) => onCommitExclusionsChange(event.target.value)} />
        <div className="filter-presets">
          {[['Clean merges', 'merge, merged'], ['Dependency noise', 'bump, dependabot, dependencies'], ['Generated changes', 'format, generated, lockfile']].map(([label, value]) => <button className="secondary-button" type="button" key={label} onClick={() => onCommitExclusionsChange(value)}>{label}</button>)}
        </div>
      </SettingsField>

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
            <input className="repo-filter-input" aria-label={`Filters for ${repo.fullName}`} placeholder="Repo filters" value={repoFilters?.[repo.fullName] || ""} onChange={(event) => onRepoFilterChange(repo.fullName, event.target.value)} />
          </label>
        ))}
      </div>
        </>
      )}
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
  googleSheetTabs,
  onLoadGoogleTabs,
  sheetMapping,
  onSheetMappingChange,
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
          {googleSheetTabs.length ? <select value={googleSheetTab} onChange={(e) => { onGoogleSheetTabChange(e.target.value); onSave({ googleSheetTab: e.target.value }); }}>{googleSheetTabs.map((tab) => <option key={tab}>{tab}</option>)}</select> : <input value={googleSheetTab} placeholder="Sheet1" onChange={(e) => onGoogleSheetTabChange(e.target.value)} onBlur={() => onSave({ googleSheetTab })} />}
          <button className="secondary-button" type="button" onClick={onLoadGoogleTabs}>Load tabs</button>
        </SettingsField>
        <SettingsField label="Default hours">
          <input value={defaultHours} inputMode="decimal" placeholder="8" onChange={(e) => onDefaultHoursChange(e.target.value)} onBlur={() => onSave({ defaultHours })} />
        </SettingsField>
      </div>
      <div className="field-grid">
        {[["date", "Date column"], ["summary", "Task column"], ["hours", "Hours column"], ["reference", "Reference column"]].map(([key, label]) => (
          <SettingsField key={key} label={label} hint={key === "reference" ? "Optional. Leave blank to protect this column." : "Use a column letter, for example A."}>
            <input value={sheetMapping[key]} placeholder={key === "reference" ? "Optional" : "A"} onChange={(event) => onSheetMappingChange({ [key]: event.target.value.toUpperCase() })} />
          </SettingsField>
        ))}
      </div>
      <button className="primary-action settings-connect" disabled={!googleClientId || !googleClientSecret} type="button" onClick={onConnectGoogle}>
        {googleConnected ? "Reconnect Google" : "Connect Google"}
      </button>
      {sheetStatus && <p className="settings-status">{sheetStatus}</p>}
    </SettingsPanel>
  );
}

function OutputSection({ onSave, onStyleChange, style, summaryPreference, onSummaryPreferenceChange }) {
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
      <SettingsField label="Summary preferences" hint="Optional rules Gemini should follow every time.">
        <textarea value={summaryPreference} placeholder="Use plain English. Keep it concise." onChange={(event) => onSummaryPreferenceChange(event.target.value)} />
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
