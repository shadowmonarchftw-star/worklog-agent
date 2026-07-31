function shouldKeepAlive(settings = {}) {
  return Boolean(settings.enabled || settings.startAtLogin);
}

function shouldStartHidden({ loginLaunch, settings }) {
  return Boolean(loginLaunch && shouldKeepAlive(settings));
}

function loginItemFor(settings = {}) {
  return { openAtLogin: Boolean(settings.startAtLogin) };
}

module.exports = {
  loginItemFor,
  shouldKeepAlive,
  shouldStartHidden,
};
