import {
  ProviderError,
  redactProviderSecrets,
} from "./providerError.mjs";
import { AutomationSetupError } from "./worklogService.mjs";

export class ValidationError extends TypeError {}

function isConflict(result) {
  return result?.outcome === "already_running" ||
    result?.status === "already_running";
}

export function automationResultResponse(result) {
  return Response.json({ result }, { status: isConflict(result) ? 409 : 200 });
}

export function automationErrorResponse(
  error,
  { fallback = "Automation failed." } = {},
) {
  if (error instanceof ProviderError) {
    return Response.json(
      { error: redactProviderSecrets(error.safeMessage) },
      { status: 502 },
    );
  }
  if (
    error instanceof ValidationError ||
    error instanceof AutomationSetupError
  ) {
    return Response.json(
      { error: redactProviderSecrets(error.message || "Invalid request.") },
      { status: 400 },
    );
  }
  return Response.json({ error: fallback }, { status: 500 });
}
