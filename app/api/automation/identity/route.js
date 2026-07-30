import {
  authorizeAutomationRequest,
  launchIdentity,
} from "../../../../lib/automationAuth.mjs";

export function createIdentityHandler({
  capability = process.env.AUTOMATION_CAPABILITY,
  nonce = process.env.AUTOMATION_LAUNCH_NONCE,
} = {}) {
  return async function GET(request) {
    const rejection = authorizeAutomationRequest(request, { capability });
    if (rejection) return rejection;
    if (!nonce) {
      return Response.json({ error: "Automation is unavailable." }, {
        status: 503,
      });
    }
    return Response.json({ identity: launchIdentity(nonce) });
  };
}

export const GET = createIdentityHandler();
