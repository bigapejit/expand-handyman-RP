// A **Photo**'s time and size, as the Photos tab and the browser pipeline read
// them (ADR 0003). Pure, so the rules are tested apart from the camera.

/** The time a photo shows: its camera time when the file had one, else when it was added. */
export function photoShownAt(photo: { takenAt?: number; addedAt: number }) {
  return photo.takenAt ?? photo.addedAt;
}

// "Taken Sep 1, 2026, 10:05 AM" when the file carried a camera time, "Added …"
// when it did not, so the time is never passed off as something it is not.
// The locale and time zone are parameters so a test can pin them; the app
// passes neither and gets the owner's own.
export function photoTimeLabel(
  photo: { takenAt?: number; addedAt: number },
  locale?: string,
  timeZone?: string,
) {
  const when = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(photoShownAt(photo));
  return `${photo.takenAt === undefined ? "Added" : "Taken"} ${when}`;
}

// The camera time as EXIF writes it, `2026:09:01 10:05:00`, read as a moment.
// With the offset the camera wrote beside it (`-07:00`) it is exact; without
// one it is read as the browser's own clock, which is the owner's, on the
// phone that took it. Anything else, the all-zero date some cameras write
// included, is no camera time at all.
export function exifTakenAt(dateTime?: string, offset?: string): number | undefined {
  const parts = dateTime?.trim().match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!parts) return undefined;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const zone = offset?.trim().match(/^([+-])(\d{2}):(\d{2})$/);
  if (zone) {
    const sign = zone[1] === "-" ? -1 : 1;
    const shift = sign * (Number(zone[2]) * 60 + Number(zone[3])) * 60_000;
    return Date.UTC(year, month - 1, day, hour, minute, second) - shift;
  }
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

// The size a photo is shrunk to: its long edge brought down to `longEdge`, the
// other side in proportion, and never enlarged, since a small picture made
// bigger only costs more to keep.
export function fitLongEdge(width: number, height: number, longEdge: number) {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// The sizes ADR 0003 settles: the full image for the photo dialog, the
// thumbnail for the grid.
export const FULL_LONG_EDGE = 2000;
export const THUMB_LONG_EDGE = 400;
