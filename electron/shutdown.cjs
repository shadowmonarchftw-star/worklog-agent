function createShutdownHandler({
  getScheduler,
  getAppServer,
  exit,
}) {
  let complete = false;
  let shuttingDown = null;

  return function shutdown(event) {
    if (complete) return shuttingDown;
    event.preventDefault();
    if (shuttingDown) return shuttingDown;

    shuttingDown = (async () => {
      try {
        await getScheduler()?.stop();
        await getAppServer()?.stop();
      } finally {
        complete = true;
        exit(0);
      }
    })();
    return shuttingDown;
  };
}

module.exports = { createShutdownHandler };
