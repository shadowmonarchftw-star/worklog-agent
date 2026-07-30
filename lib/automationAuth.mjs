import { createHash, timingSafeEqual } from "node:crypto";

function jsonError(error, status) {
  return Response.json({ error }, { status });
}

function isLoopback(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function requestHost(request) {
  const supplied = request.headers.get("host");
  try {
    return new URL(`http://${supplied || new URL(request.url).host}`).hostname;
  } catch {
    return "";
  }
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return request.headers.get("sec-fetch-site") !== "cross-site";
  }
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    const host = request.headers.get("host") || requestUrl.host;
    return originUrl.protocol === requestUrl.protocol && originUrl.host === host;
  } catch {
    return false;
  }
}

function equalSecret(left, right) {
  const leftDigest = createHash("sha256").update(String(left)).digest();
  const rightDigest = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function authorizeAutomationRequest(
  request,
  {
    capability,
    mutation = false,
    requireCapability = true,
    requireOrigin = false,
  } = {},
) {
  if (!isLoopback(requestHost(request))) {
    return jsonError("Automation is available only on loopback.", 403);
  }
  if (
    mutation &&
    ((requireOrigin && !request.headers.get("origin")) || !sameOrigin(request))
  ) {
    return jsonError("Cross-origin automation requests are forbidden.", 403);
  }
  if (requireCapability) {
    const authorization = request.headers.get("authorization") || "";
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!capability || !match || !equalSecret(match[1], capability)) {
      return jsonError("Unauthorized.", 401);
    }
  }
  return null;
}

export function launchIdentity(nonce) {
  return createHash("sha256")
    .update(`ai-worklog-agent:${String(nonce || "")}`)
    .digest("hex");
}
