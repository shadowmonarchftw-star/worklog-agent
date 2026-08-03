const WAKE_INTERVAL_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;

function defaultClock() {
  return {
    clearInterval,
    clearTimeout,
    now: () => new Date(),
    setInterval,
    setTimeout,
    timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function timezoneAt(clock) {
  return typeof clock.timezone === "function"
    ? clock.timezone()
    : clock.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
    weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      .indexOf(values.weekday) + 1,
  };
}

function sanitize(value) {
  return String(value?.message || value || "Automation failed.")
    .replace(
      /\bAuthorization\s*:\s*(?:Bearer|Basic)?\s*[^\s,;]+/gi,
      "Authorization: [REDACTED]",
    )
    .replace(
      /\b(token|key|secret|password|credential)\s*=\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\bgh[oprsu]_[A-Za-z0-9_]{16,}\b/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "Automation failed.";
}

function notificationFor(result) {
  const warning = result?.warnings?.[0];
  if (result?.status === "success") {
    const body = result.action === "appended"
      ? "Today's worklog was added."
      : "Today's worklog was updated.";
    return {
      title: "Worklog complete",
      body: warning ? `${body} ${warning}` : body,
    };
  }
  if (result?.status === "no_activity") {
    return {
      title: "No activity",
      body: warning
        ? `No worklog was written today. ${warning}`
        : "No worklog was written today.",
    };
  }
  return null;
}

function createScheduler({
  clock = defaultClock(),
  loadSettings,
  loadStatus,
  recover,
  run,
  notify,
}) {
  let timer = null;
  let activeController = null;
  let activePromise = null;
  let reconciliationNeeded = true;
  let stopped = false;
  const completedDates = new Set();

  async function exclusive(operation) {
    if (stopped) return { outcome: "stopped" };
    if (activePromise) return { outcome: "already_running" };
    const controller = new AbortController();
    activeController = controller;
    const promise = Promise.resolve().then(() => operation(controller.signal));
    activePromise = promise;
    try {
      return await promise;
    } finally {
      if (activePromise === promise) {
        activeController = null;
        activePromise = null;
      }
    }
  }

  async function reconcile(signal) {
    try {
      const result = await recover({ signal });
      if (result?.outcome === "already_running") {
        return { blocked: true, result };
      }
      const failed = Array.isArray(result?.results)
        ? result.results.filter((entry) => entry?.status === "failed")
        : [];
      for (const entry of failed) {
        notify({
          title: entry.errorCategory === "sheet_conflict"
            ? "Worklog recovery needs attention"
            : "Worklog recovery failed",
          body: sanitize(entry.errorMessage || "Worklog recovery failed."),
        });
      }
      if (result?.maintenanceWarning) {
        notify({
          title: "Worklog maintenance warning",
          body: sanitize(
            result.maintenanceWarning.safeMessage ||
              "Automation cleanup failed.",
          ),
        });
      }
      reconciliationNeeded = false;
      return { blocked: failed.length > 0, result };
    } catch (error) {
      if (signal?.aborted) {
        return { blocked: true, result: { outcome: "stopped" } };
      }
      reconciliationNeeded = true;
      notify({
        title: "Worklog recovery failed",
        body: sanitize(error),
      });
      return {
        blocked: true,
        result: { status: "failed", error: sanitize(error) },
      };
    }
  }

  async function execute(input, workDate, signal) {
    try {
      const result = await run(input, { signal });
      if (result?.outcome === "already_running" ||
          result?.status === "already_running") {
        return { outcome: "already_running" };
      }
      const payload = notificationFor(result);
      if (payload) notify(payload);
      if (
        workDate &&
        (result?.status === "success" || result?.status === "no_activity")
      ) {
        completedDates.add(workDate);
      }
      return result;
    } catch (error) {
      if (signal?.aborted) return { outcome: "stopped" };
      const message = sanitize(error);
      notify({ title: "Worklog failed", body: message });
      return { status: "failed", error: message };
    }
  }

  async function evaluate(now, signal) {
    if (reconciliationNeeded) {
      const recovery = await reconcile(signal);
      if (
        reconciliationNeeded ||
        recovery.blocked ||
        recovery.result?.outcome === "already_running"
      ) {
        return recovery.result;
      }
    }

    const settings = await loadSettings({ signal });
    const status = await loadStatus({ signal });
    if (!settings.enabled) return { status };

    const timezone = timezoneAt(clock);
    const local = localParts(now, timezone);
    if (settings.skipDate === local.date || !settings.days.includes(local.weekday) || completedDates.has(local.date)) {
      return { status };
    }

    const latest = status.lastAutomaticAttempt;
    if (
      latest?.workDate === local.date &&
      latest.trigger === "automatic"
    ) {
      if (["success", "no_activity", "running"].includes(latest.status)) {
        return { status };
      }
      if (latest.status === "failed") {
        if (
          !latest.retryDueAt ||
          new Date(latest.retryDueAt).valueOf() > now.valueOf()
        ) {
          return { status };
        }
        return execute({
          trigger: "automatic",
          workDate: local.date,
          timezone,
        }, local.date, signal);
      }
    }

    const [hour, minute] = settings.time.split(":").map(Number);
    if (local.minutes < hour * 60 + minute) return { status };
    return execute({
      trigger: "automatic",
      workDate: local.date,
      timezone,
    }, local.date, signal);
  }

  function tick(now = clock.now()) {
    return exclusive((signal) => evaluate(new Date(now), signal));
  }

  function resume(now = clock.now()) {
    return exclusive(async (signal) => {
      reconciliationNeeded = true;
      const recovery = await reconcile(signal);
      if (
        reconciliationNeeded ||
        recovery.blocked ||
        recovery.result?.outcome === "already_running"
      ) {
        return recovery.result;
      }
      return evaluate(new Date(now), signal);
    });
  }

  function runNow(now = clock.now()) {
    return exclusive((signal) => {
      const timezone = timezoneAt(clock);
      const { date: workDate } = localParts(new Date(now), timezone);
      return execute({ trigger: "manual", workDate, timezone }, null, signal);
    });
  }

  async function stop() {
    stopped = true;
    if (timer) clock.clearInterval(timer);
    timer = null;
    const pending = activePromise;
    if (!pending) return;
    activeController?.abort(new Error("Scheduler stopped."));
    let timeout;
    const bounded = new Promise((resolve) => {
      timeout = clock.setTimeout(resolve, STOP_TIMEOUT_MS);
    });
    await Promise.race([pending.catch(() => {}), bounded]);
    if (timeout) clock.clearTimeout(timeout);
  }

  function start() {
    stopped = false;
    return exclusive(async (signal) => {
      const recovery = await reconcile(signal);
      let result = recovery.result;
      if (
        !reconciliationNeeded &&
        !recovery.blocked &&
        recovery.result?.outcome !== "already_running"
      ) {
        result = await evaluate(new Date(clock.now()), signal);
      }
      if (!timer) {
        timer = clock.setInterval(() => {
          void tick();
        }, WAKE_INTERVAL_MS);
      }
      return result;
    });
  }

  return { start, stop, tick, resume, runNow };
}

module.exports = { createScheduler };
