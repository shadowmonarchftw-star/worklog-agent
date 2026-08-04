import { getAppDb, getSetting, setSetting } from "../../../../lib/localDb.mjs";
import { unreadableCredentials } from "../../../../lib/secureSettings.mjs";
import { normalizeToken } from "../../../../lib/githubActivity.mjs";
import { preflightLocalGit } from "../../../../lib/localGitProvider.mjs";
import { generateGeminiSummary } from "../../../../lib/geminiProvider.mjs";
import { generateLocalSummary } from "../../../../lib/localModelProvider.mjs";
import { summaryProviderName } from "../../../../lib/worklogService.mjs";
import { inspectGoogleSheet, readGoogleSheetRow } from "../../../../lib/googleSheetsProvider.mjs";
import { localDateAt } from "../../../../lib/localDate.mjs";

const settingsKey = "app-settings";
const tokensKey = "google-tokens";

function check(id, label, status, message) {
  return { id, label, status, message };
}

async function checkGithub(settings) {
  if (!settings.githubToken?.trim()) return check("github", "GitHub", "fail", "GitHub token missing.");
  try {
    const token = normalizeToken(settings.githubToken);
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return check("github", "GitHub", "fail", "Token rejected or GitHub account unavailable.");
    return check("github", "GitHub", "pass", "Token accepted.");
  } catch (error) {
    return check("github", "GitHub", "fail", error.message || "Could not reach GitHub.");
  }
}

async function checkLocalGit(settings) {
  if (settings.activitySource !== "local") return check("local-git", "Local Git", "skip", "Not selected as activity source.");
  try {
    await preflightLocalGit({ repositories: settings.localRepositories || [] });
    return check("local-git", "Local Git", "pass", `${(settings.localRepositories || []).length} repository(s) ready.`);
  } catch (error) {
    return check("local-git", "Local Git", "fail", error.safeMessage || error.message);
  }
}

async function checkSummaryModel(settings) {
  const local = summaryProviderName(settings) === "local";
  const label = local ? "Local model" : "Gemini";
  if (local && !settings.localModelName?.trim()) {
    return check("summary-model", label, "fail", "Local model name missing.");
  }
  if (!local && !settings.geminiApiKey?.trim()) {
    return check("summary-model", label, "fail", "Gemini API key missing.");
  }
  const probe = {
    workDate: localDateAt(),
    style: "sheet-cell",
    activity: "setup check: verify summary generation",
  };
  try {
    const result = local
      ? await generateLocalSummary({
        ...probe,
        baseUrl: settings.localModelBaseUrl,
        model: settings.localModelName,
        apiKey: settings.localModelApiKey,
      })
      : await generateGeminiSummary({ ...probe, apiKey: settings.geminiApiKey });
    return check("summary-model", label, "pass", `Summary generation works (${result.model}).`);
  } catch (error) {
    return check(
      "summary-model",
      label,
      "fail",
      error.safeMessage || error.message || "Summary generation failed.",
    );
  }
}

async function checkGoogle(settings, tokens) {
  if (!tokens?.access_token && !tokens?.refresh_token) return check("google", "Google Sheets", "fail", "Google account not connected.");
  if (!settings.googleSheetLink?.trim()) return check("google", "Google Sheets", "fail", "Google Sheet link missing.");
  try {
    await readGoogleSheetRow({ settings, tokens, workDate: localDateAt(), saveTokens: (next) => setSetting(getAppDb(), tokensKey, next) });
    await inspectGoogleSheet({ settings, tokens, saveTokens: (next) => setSetting(getAppDb(), tokensKey, next) });
    return check("google", "Google Sheets", "pass", `Sheet tab "${settings.googleSheetTab || "Sheet1"}" is readable and headers are valid.`);
  } catch (error) {
    return check("google", "Google Sheets", "fail", error.safeMessage || error.message || "Could not read Google Sheet.");
  }
}

function checkCredentials(settings, tokens) {
  const unreadable = [...unreadableCredentials(settings), ...unreadableCredentials(tokens)];
  if (!unreadable.length) return check("credentials", "Stored credentials", "pass", "Saved credentials decrypted.");
  return check(
    "credentials",
    "Stored credentials",
    "fail",
    `Could not decrypt ${unreadable.join(", ")}. The credential key changed or was lost — re-enter these in Settings.`,
  );
}

export async function GET() {
  const db = getAppDb();
  const settings = getSetting(db, settingsKey) || {};
  const tokens = getSetting(db, tokensKey);
  const source = settings.activitySource || "github";
  const checks = await Promise.all([
    Promise.resolve(checkCredentials(settings, tokens)),
    Promise.resolve(check("source", "Activity source", "pass", source === "local" ? "Local Git selected." : "GitHub selected.")),
    source === "local" ? checkLocalGit(settings) : checkGithub(settings),
    checkSummaryModel(settings),
    checkGoogle(settings, tokens),
  ]);
  return Response.json({ checks, ranAt: new Date().toISOString() });
}
