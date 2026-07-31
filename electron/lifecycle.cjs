function shouldKeepAlive(settings = {}) {
  return Boolean(settings.enabled || settings.startAtLogin);
}

function shouldStartHidden({ loginLaunch, settings }) {
  return Boolean(loginLaunch && shouldKeepAlive(settings));
}

function loginItemFor(settings = {}) {
  return { openAtLogin: Boolean(settings.startAtLogin) };
}

function normalizeDirectorySelection(result = {}) {
  if (result.canceled) return null;
  return result.filePaths?.[0] || null;
}

module.exports = {
  loginItemFor,
  normalizeDirectorySelection,
  shouldKeepAlive,
  shouldStartHidden,
};
