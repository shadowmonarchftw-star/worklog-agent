import { authorizeAutomationRequest } from "./automationAuth.mjs";

// The routes the UI calls cannot carry the per-launch capability token: the
// browser app is never given it. They still must not be drivable by another page
// in the user's browser, which can reach 127.0.0.1 as easily as the app can, so
// they keep the loopback and same-origin checks.
//
// Pass mutation for anything that changes state or makes the server act on
// request input. Read-only GETs take loopback alone, because a cross-origin page
// cannot read their responses and a same-origin check would break any request
// the browser makes as a top-level navigation.
export function guardLocalRequest(request, { mutation = false } = {}) {
  return authorizeAutomationRequest(request, {
    mutation,
    requireCapability: false,
  });
}
