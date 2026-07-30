function datePartsAt(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
}

function calendarParts(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid local date: ${date}`);
  }
  const result = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const normalized = new Date(0);
  normalized.setUTCHours(0, 0, 0, 0);
  normalized.setUTCFullYear(result.year, result.month - 1, result.day);
  if (
    normalized.getUTCFullYear() !== result.year
    || normalized.getUTCMonth() + 1 !== result.month
    || normalized.getUTCDate() !== result.day
  ) {
    throw new Error(`Invalid local date: ${date}`);
  }
  return result;
}

function addCalendarDays(date, days) {
  const { year, month, day } = calendarParts(date);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = value.getUTCFullYear();
  const nextMonth = String(value.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(value.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function matchesLocalDateTime(parts, expected) {
  return parts.year === expected.year
    && parts.month === expected.month
    && parts.day === expected.day
    && parts.hour === expected.hour
    && parts.minute === expected.minute;
}

function firstValidTimeAfterGap(expected, target, timezone) {
  const expectedMinutes = expected.hour * 60 + expected.minute;
  let best;

  for (
    let instant = target - 18 * 60 * 60 * 1000;
    instant <= target + 18 * 60 * 60 * 1000;
    instant += 60 * 1000
  ) {
    const parts = datePartsAt(new Date(instant), timezone);
    const localMinutes = parts.hour * 60 + parts.minute;
    if (
      parts.year === expected.year
      && parts.month === expected.month
      && parts.day === expected.day
      && localMinutes >= expectedMinutes
      && (!best || localMinutes < best.localMinutes)
    ) {
      best = { instant, localMinutes };
    }
  }

  return best ? new Date(best.instant) : null;
}

function zonedDateTimeCandidates(date, time, timezone) {
  const { year, month, day } = calendarParts(date);
  const [hour, minute] = time.split(":").map(Number);
  const expected = { year, month, day, hour, minute };
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set();

  for (let delta = -36; delta <= 36; delta += 6) {
    const instant = target + delta * 60 * 60 * 1000;
    const parts = datePartsAt(new Date(instant), timezone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    offsets.add(represented - instant);
  }

  const candidates = [...offsets]
    .map((offset) => new Date(target - offset))
    .filter((instant) => matchesLocalDateTime(
      datePartsAt(instant, timezone),
      expected,
    ))
    .sort((left, right) => left - right);

  if (candidates.length) {
    return candidates;
  }

  const firstValid = firstValidTimeAfterGap(expected, target, timezone);
  return firstValid ? [firstValid] : [];
}

function zonedDateTime(date, time, timezone) {
  const [candidate] = zonedDateTimeCandidates(date, time, timezone);
  if (!candidate) {
    throw new Error(`Unable to resolve local date and time: ${date} ${time}`);
  }
  return candidate;
}

export function localDateAt(now = new Date(), timezone = localTimezone()) {
  const { year, month, day } = datePartsAt(new Date(now), timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isoWeekday(date, timezone = localTimezone()) {
  const instant = zonedDateTime(date, "12:00", timezone);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(instant);
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday) + 1;
}

export function localDayUtcRange(date, timezone = localTimezone()) {
  return {
    since: zonedDateTime(date, "00:00", timezone).toISOString(),
    until: zonedDateTime(addCalendarDays(date, 1), "00:00", timezone).toISOString(),
  };
}

export function nextScheduledAt({
  now = new Date(),
  time,
  days,
  timezone = localTimezone(),
}) {
  const current = new Date(now);
  const startDate = localDateAt(current, timezone);
  const selectedDays = new Set(days);

  for (let offset = 0; offset <= 7; offset += 1) {
    const date = addCalendarDays(startDate, offset);
    if (!selectedDays.has(isoWeekday(date, timezone))) {
      continue;
    }
    const candidate = zonedDateTimeCandidates(date, time, timezone)
      .find((instant) => instant >= current);
    if (candidate) {
      return candidate.toISOString();
    }
  }

  return null;
}
