import { randomUUID } from "node:crypto";

import { authorizeAutomationRequest } from "../../../../lib/automationAuth.mjs";
import {
  automationErrorResponse,
  automationResultResponse,
} from "../../../../lib/automationHttp.mjs";
import {
  claimAutomationRecovery,
} from "../../../../lib/automationStore.mjs";
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
      return automationResultResponse(await recover(await loadInput()));
    } catch (error) {
      return automationErrorResponse(error, { fallback: "Recovery failed." });
    }
  };
}

export const POST = createRecoverHandler();
