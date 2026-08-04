// Squirrel.Mac validates a downloaded update against the *installed* app's
// designated requirement before swapping it in. For an ad-hoc signed app
// (`"identity": "-"`) that requirement is a literal hash of the installed
// binary, so no later build can ever satisfy it and quitAndInstall always fails
// with "code failed to satisfy specified code req". Until the app is signed with
// a real Developer ID, macOS is offered a download link instead of an in-app
// install, rather than downloading 130 MB to hit that wall.
function supportsInAppInstall({ platform, codeSigned = false } = {}) {
  if (platform !== "darwin") return true;
  return Boolean(codeSigned);
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function releasePageUrl({ owner, repo, version } = {}) {
  if (!SAFE_SEGMENT.test(owner || "") || !SAFE_SEGMENT.test(repo || "")) {
    return null;
  }
  const base = `https://github.com/${owner}/${repo}/releases`;
  if (!version) return `${base}/latest`;
  if (!SAFE_SEGMENT.test(version)) return null;
  const tag = version.startsWith("v") ? version : `v${version}`;
  return `${base}/tag/${tag}`;
}

module.exports = {
  releasePageUrl,
  supportsInAppInstall,
};
