// How a document out with a customer reads on a Dashboard row: when its link
// was created, whether the customer has opened it, and how it was answered. Each
// takes the locale and time zone so a test can pin them; the app passes neither
// and gets the owner's own.

export function issuedLine(issuedAt: number, locale?: string, timeZone?: string) {
  const when = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(issuedAt);
  return `Link created ${when}`;
}

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

export function decidedLine(
  d: {
    status: "signed" | "declined";
    decidedAt: number;
    signerName?: string;
    declineReason?: string;
  },
  locale?: string,
  timeZone?: string,
) {
  const day = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(d.decidedAt);
  if (d.status === "signed")
    return d.signerName ? `Signed ${day} by ${d.signerName}` : `Signed ${day}`;
  return d.declineReason ? `Declined ${day}: ${d.declineReason}` : `Declined ${day}`;
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

// Days since the epoch, counted in the given zone's calendar.
function calendarDay(at: number, timeZone?: string) {
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
