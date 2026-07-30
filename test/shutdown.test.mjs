import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createShutdownHandler } = require("../electron/shutdown.cjs");

test("shutdown prevents default, stops scheduler then server, and exits once", async () => {
  const calls = [];
  const event = {
    preventDefault() {
      calls.push("prevent");
    },
  };
  const shutdown = createShutdownHandler({
    getScheduler: () => ({
      stop: async () => calls.push("scheduler"),
    }),
    getAppServer: () => ({
      stop: async () => calls.push("server"),
    }),
    exit: (code) => calls.push(`exit-${code}`),
  });

  await shutdown(event);
  await shutdown(event);

  assert.deepEqual(calls, [
    "prevent",
    "scheduler",
    "server",
    "exit-0",
  ]);
});
