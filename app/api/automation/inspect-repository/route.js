import { authorizeAutomationRequest } from "../../../../lib/automationAuth.mjs";
import { inspectLocalRepository } from "../../../../lib/localGitProvider.mjs";

export function createInspectRepositoryHandler({
  capability = process.env.AUTOMATION_CAPABILITY,
  inspect = inspectLocalRepository,
} = {}) {
  return async function POST(request) {
    const rejection = authorizeAutomationRequest(request, {
      capability,
      mutation: true,
    });
    if (rejection) return rejection;
    try {
      const body = await request.json();
      if (typeof body?.path !== "string" || !body.path.trim()) {
        return Response.json({ error: "Choose a repository folder." }, {
          status: 400,
        });
      }
      return Response.json({
        repository: await inspect(body.path),
      });
    } catch (error) {
      return Response.json({
        error: error.safeMessage || "Could not inspect the local repository.",
      }, { status: 400 });
    }
  };
}

export const POST = createInspectRepositoryHandler();
