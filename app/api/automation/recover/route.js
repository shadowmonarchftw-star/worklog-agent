import { randomUUID } from "node:crypto";

import { authorizeAutomationRequest } from "../../../../lib/automationAuth.mjs";
import {
  claimAutomationRecovery,
} from "../../../../lib/automationStore.mjs";
import { redactProviderSecrets } from "../../../../lib/providerError.mjs";
import { recoverInterruptedRuns } from "../../../../lib/worklogService.mjs";
import { loadAutomationInput } from "../run/route.js";

async function loadRecoveryInput() {
  const input = await loadAutomationInput({});
  return {
    ...input,
    ownerId: randomUUID(),
    lease: {
      ...input.lease,
      claimRecovery: (claim) => claimAutomationRecovery(
        input.database,
        claim,
      ),
    },
  };
}

export function createRecoverHandler({
  capability = process.env.AUTOMATION_CAPABILITY,
  recover = recoverInterruptedRuns,
  loadInput = loadRecoveryInput,
} = {}) {
  return async function POST(request) {
    const rejection = authorizeAutomationRequest(request, {
      capability,
      mutation: true,
    });
    if (rejection) return rejection;
    try {
      return Response.json({ result: await recover(await loadInput()) });
    } catch (error) {
      return Response.json(
        {
          error: redactProviderSecrets(
            error.safeMessage || error.message || "Recovery failed.",
          ),
        },
        { status: 400 },
      );
    }
  };
}

export const POST = createRecoverHandler();
