import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const secretFields = new Set([
  "githubToken",
  "geminiApiKey",
  "googleClientSecret",
  // Optional for Ollama and LM Studio, but LiteLLM and corporate proxies issue
  // a real credential here.
  "localModelApiKey",
]);

function key() {
  const raw = process.env.WORKLOG_AGENT_CREDENTIAL_KEY;
  return raw ? createHash("sha256").update(raw).digest() : null;
}

function seal(value) {
  const encryptionKey = key();
  if (!encryptionKey || !value) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return { __encrypted: true, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64") };
}

const UNREADABLE = Symbol("unreadable-credential");

export const UNREADABLE_CREDENTIALS_FIELD = "__unreadableCredentials";

function open(value) {
  if (!value?.__encrypted) return value;
  const encryptionKey = key();
  // Stored value is sealed but the credential key is gone or changed. Report it
  // instead of returning "" — an empty token is indistinguishable from "never set".
  if (!encryptionKey) return UNREADABLE;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return UNREADABLE;
  }
}

export function protectSetting(keyName, value) {
  if (keyName === "google-tokens") return seal(JSON.stringify(value));
  if (keyName !== "app-settings" || !value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, secretFields.has(name) ? seal(item) : item]));
}

export function revealSetting(keyName, value) {
  if (keyName === "google-tokens") {
    const decoded = open(value);
    if (decoded === UNREADABLE) return { [UNREADABLE_CREDENTIALS_FIELD]: ["googleTokens"] };
    if (typeof decoded === "string") {
      try { return JSON.parse(decoded); } catch { return null; }
    }
    return decoded;
  }
  if (keyName !== "app-settings" || !value || typeof value !== "object") return value;
  const unreadable = [];
  const revealed = Object.fromEntries(Object.entries(value).map(([name, item]) => {
    if (!secretFields.has(name)) return [name, item];
    const opened = open(item);
    if (opened === UNREADABLE) {
      unreadable.push(name);
      return [name, ""];
    }
    return [name, opened];
  }));
  if (unreadable.length) revealed[UNREADABLE_CREDENTIALS_FIELD] = unreadable;
  return revealed;
}

export function unreadableCredentials(settings) {
  return settings?.[UNREADABLE_CREDENTIALS_FIELD] || [];
}
