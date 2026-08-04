import { authorizeAutomationRequest } from "../../../../lib/automationAuth.mjs";
import { listLocalModels } from "../../../../lib/localModelProvider.mjs";

export async function POST(request) {
  // This route makes the server fetch a URL supplied in the request body, so a
  // page in the user's browser must not be able to drive it. Loopback plus
  // same-origin is the same guard the automation routes use; the per-launch
  // capability token is not required because the settings UI has no way to send
  // one.
  const denied = authorizeAutomationRequest(request, {
    mutation: true,
    requireCapability: false,
  });
  if (denied) return denied;

  try {
    const body = await request.json();
    // The URL and key come from the request rather than saved settings so the
    // list can be fetched while the fields are still being typed.
    const models = await listLocalModels({
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
    });
    return Response.json({ models });
  } catch (error) {
    const status = error.category === "local_model" ? 502 : 400;
    return Response.json(
      { error: error.safeMessage || error.message },
      { status },
    );
  }
}
