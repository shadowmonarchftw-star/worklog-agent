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
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function addCalendarDays(date, days) {
  const { year, month, day } = calendarParts(date);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = value.getUTCFullYear();
  const nextMonth = String(value.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(value.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function zonedDateTime(date, time, timezone) {
  const { year, month, day } = calendarParts(date);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let instant = target;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = datePartsAt(new Date(instant), timezone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const next = instant + target - represented;
    if (next === instant) {
      break;
    }
    instant = next;
  }

  return new Date(instant);
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
    const candidate = zonedDateTime(date, time, timezone);
    if (candidate >= current) {
      return candidate.toISOString();
    }
  }

  return null;
}
