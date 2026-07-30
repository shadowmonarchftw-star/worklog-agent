function isTrustedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "accounts.google.com";
  } catch {
    return false;
  }
}

function registerExternalLinkHandler(window, openExternal) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedExternalUrl(url)) {
      void openExternal(url);
    }

    return { action: "deny" };
  });
}

module.exports = {
  isTrustedExternalUrl,
  registerExternalLinkHandler,
};
