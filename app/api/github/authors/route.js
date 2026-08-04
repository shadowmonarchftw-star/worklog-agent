import { guardLocalRequest } from "../../../../lib/localRouteAuth.mjs";
import { extractCommitAuthors, normalizeToken } from "../../../../lib/githubActivity.mjs";

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
    const { githubToken, repoFullNames } = await request.json();
    const token = normalizeToken(githubToken);
    const repos = repoFullNames || [];

    if (!repos.length) {
      const currentUser = await fetchCurrentUser(token);
      return Response.json({
        authors: extractCommitAuthors([], { currentUser }),
      });
    }

    const [currentUser, commitGroups, contributorGroups] = await Promise.all([
      fetchCurrentUser(token),
      Promise.all(
      repos.map(async (repo) => {
        const response = await fetch(
          `https://api.github.com/repos/${repo}/commits?per_page=100`,
          { headers: githubHeaders(token) },
        );

        if (!response.ok) {
          return [];
        }

        return response.json();
      }),
      ),
      Promise.all(
        repos.map(async (repo) => {
          const response = await fetch(
            `https://api.github.com/repos/${repo}/contributors?per_page=100`,
            { headers: githubHeaders(token) },
          );

          if (!response.ok) {
            return [];
          }

          return response.json();
        }),
      ),
    ]);

    const contributorCommits = contributorGroups.flat().map((item) => ({
      author: { login: item.login },
      commit: { author: { name: item.login } },
    }));

    return Response.json({
      authors: extractCommitAuthors([...commitGroups.flat(), ...contributorCommits], {
        currentUser,
      }),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}

async function fetchCurrentUser(token) {
  const response = await fetch("https://api.github.com/user", {
    headers: githubHeaders(token),
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}
