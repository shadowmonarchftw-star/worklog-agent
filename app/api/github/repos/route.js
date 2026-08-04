import { guardLocalRequest } from "../../../../lib/localRouteAuth.mjs";
import { normalizeToken } from "../../../../lib/githubActivity.mjs";

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function POST(request) {
  const denied = guardLocalRequest(request, { mutation: true });
  if (denied) return denied;
  try {
    const { githubToken } = await request.json();
    const token = normalizeToken(githubToken);

    const response = await fetch(
      "https://api.github.com/user/repos?per_page=100&sort=updated",
      {
        headers: githubHeaders(token),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      return Response.json(
        { error: `GitHub repos request failed: ${errorText}` },
        { status: response.status },
      );
    }

    const repos = await response.json();
    return Response.json({
      repos: repos.map((repo) => ({
        id: repo.id,
        fullName: repo.full_name,
        private: repo.private,
        updatedAt: repo.updated_at,
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}
