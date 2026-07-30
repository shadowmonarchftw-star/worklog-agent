import { collectGithubActivity } from "../../../../lib/githubProvider.mjs";

export async function POST(request) {
  try {
    const {
      githubToken,
      repoFullName,
      repoFullNames,
      date,
      author,
      since: suppliedSince,
      until: suppliedUntil,
    } = await request.json();
    const repos = repoFullNames?.length ? repoFullNames : [repoFullName].filter(Boolean);
    return Response.json(await collectGithubActivity({
      token: githubToken, repos, date, author,
      since: suppliedSince, until: suppliedUntil,
    }));
  } catch (error) {
    return Response.json(
      { error: error.safeMessage || error.message },
      { status: 400 },
    );
  }
}
