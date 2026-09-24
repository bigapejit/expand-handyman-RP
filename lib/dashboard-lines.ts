// How a proposal out with a customer reads on a Dashboard row: whether the
// customer has opened it. Takes the locale and time zone so a test can pin
// them; the app passes neither and gets the owner's own.

// "Opened twice, last Tuesday": the customer's views of the current link, and
// how recently, which is what decides whether to chase them today.
export function openedLine(
  count: number,
  lastViewedAt: number | undefined,
  now: number,
  locale?: string,
  timeZone?: string,
) {
  if (count === 0 || lastViewedAt === undefined) return "Not opened";
  const times = count === 1 ? "once" : count === 2 ? "twice" : `${count} times`;
  return `Opened ${times}, ${dayPhrase(lastViewedAt, now, locale, timeZone)}`;
}

// Today, yesterday, a weekday within the last week, then a date.
function dayPhrase(at: number, now: number, locale?: string, timeZone?: string) {
  const days = calendarDay(now, timeZone) - calendarDay(at, timeZone);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7)
    return `last ${new Intl.DateTimeFormat(locale, { weekday: "long", timeZone }).format(at)}`;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year:
      calendarYear(at, timeZone) === calendarYear(now, timeZone)
        ? undefined
        : "numeric",
    timeZone,
  }).format(at);
}

// Days since the epoch, counted in the given zone's calendar. Shared with the
// Sites list's activity label (lib/sites.ts).
export function calendarDay(at: number, timeZone?: string) {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  })
    .format(at)
    .split("-")
    .map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function calendarYear(at: number, timeZone?: string) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone }).format(at);
}
