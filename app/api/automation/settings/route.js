import { authorizeAutomationRequest } from "../../../../lib/automationAuth.mjs";
import {
  getAutomationSettings,
  getAutomationStatus,
  saveAutomationSettings,
} from "../../../../lib/automationStore.mjs";
import { getAppDb } from "../../../../lib/localDb.mjs";

const allowedFields = new Set(["enabled", "time", "days", "startAtLogin"]);

function publicSettings(settings) {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) =>
      allowedFields.has(key) || key === "startAtLoginConfigured"
    ),
  );
}

function validatePatch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Automation settings must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new TypeError(`Unknown automation setting: ${key}`);
    }
  }
  if ("enabled" in value && typeof value.enabled !== "boolean") {
    throw new TypeError("enabled must be a boolean");
  }
  if ("startAtLogin" in value && typeof value.startAtLogin !== "boolean") {
    throw new TypeError("startAtLogin must be a boolean");
  }
  if ("time" in value && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time)) {
    throw new TypeError("Automation time must use HH:mm");
  }
  if ("days" in value && (
    !Array.isArray(value.days) ||
    value.days.length === 0 ||
    value.days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
  )) {
    throw new TypeError("Automation days must be ISO weekday values 1 through 7");
  }
  return value;
}

export function createSettingsHandlers({
  getSettings = () => getAutomationSettings(getAppDb()),
  getStatus = () => getAutomationStatus(getAppDb()),
  saveSettings = (patch) => saveAutomationSettings(getAppDb(), patch),
} = {}) {
  return {
    async GET(request) {
      const rejection = authorizeAutomationRequest(request, {
        requireCapability: false,
      });
      if (rejection) return rejection;
      return Response.json({
        settings: publicSettings(getSettings()),
        status: getStatus(),
      });
    },
    async POST(request) {
      const rejection = authorizeAutomationRequest(request, {
        mutation: true,
        requireCapability: false,
        requireOrigin: true,
      });
      if (rejection) return rejection;
      try {
        const settings = publicSettings(
          saveSettings(validatePatch(await request.json())),
        );
        return Response.json({ settings, status: getStatus() });
      } catch (error) {
        return Response.json({ error: error.message }, { status: 400 });
      }
    },
  };
}

const handlers = createSettingsHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
