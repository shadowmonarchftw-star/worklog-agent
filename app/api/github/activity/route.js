import { collectGithubActivity } from "../../../../lib/githubProvider.mjs";
import { collectLocalGitActivity } from "../../../../lib/localGitProvider.mjs";
import { localDayUtcRange, localTimezone } from "../../../../lib/localDate.mjs";

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
      activitySource,
      localRepositories,
    } = await request.json();
    if (activitySource === "local") {
      const range = suppliedSince && suppliedUntil
        ? { since: suppliedSince, until: suppliedUntil }
        : localDayUtcRange(date, localTimezone());
      return Response.json(await collectLocalGitActivity({
        repositories: localRepositories,
        date,
        ...range,
      }));
    }
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
