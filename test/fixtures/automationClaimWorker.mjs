import { parentPort, workerData } from "node:worker_threads";

import { claimAutomationAttempt } from "../../lib/automationStore.mjs";
import { createLocalDb } from "../../lib/localDb.mjs";

const db = createLocalDb(workerData.dbPath);
const start = new Int32Array(workerData.startSignal);

parentPort.postMessage({ type: "ready" });
Atomics.wait(start, 0, 0);
parentPort.postMessage({
  type: "result",
  claim: claimAutomationAttempt(db, {
    workDate: "2026-07-30",
    trigger: "automatic",
    ownerId: workerData.ownerId,
    timezone: "Asia/Kathmandu",
    since: "2026-07-29T18:15:00.000Z",
    until: "2026-07-30T18:15:00.000Z",
    now: "2026-07-30T10:00:00.000Z",
  }),
});
db.close();
