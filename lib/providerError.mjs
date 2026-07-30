const SECRET_PATTERNS = [
  [/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED]"],
  [/\bgh[oprsu]_[A-Za-z0-9_]+\b/g, "[REDACTED]"],
  [/\bAIza[A-Za-z0-9_-]+\b/g, "[REDACTED]"],
  [/\bAuthorization\s*:\s*[^\s,;]+(?:\s+[^\s,;]+)?/gi, "Authorization: [REDACTED]"],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]"],
  [
    /([?&]|["']?\b)(?:access_token|refresh_token|id_token|oauth_token|client_secret|clientSecret|api_key|apikey|token|code|key|secret|password|credential)(["']?\s*[:=]\s*["']?)[^"'&\s,;}]+/gi,
    "$1credential$2[REDACTED]",
  ],
];

export function redactProviderSecrets(value) {
  let safe = String(value ?? "");
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    safe = safe.replace(pattern, replacement);
  }
  return safe;
}

export class ProviderError extends Error {
  constructor(category, safeMessage, options = {}) {
    const message = redactProviderSecrets(safeMessage) || "Provider request failed.";
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ProviderError";
    this.category = String(category || "provider");
    this.safeMessage = message;
  }

  toJSON() {
    return {
      name: this.name,
      category: this.category,
      safeMessage: this.safeMessage,
    };
  }
}

export function toProviderError(error, category, fallbackMessage) {
  if (error instanceof ProviderError) return error;
  return new ProviderError(category, fallbackMessage, { cause: error });
}
