import { describe, expect, test } from "vitest";
import { decidedLine, issuedLine, openedLine } from "../lib/dashboard-lines";

const zone = "America/Los_Angeles";
// Wednesday 23 September 2026, 9:00 in Vancouver, WA.
const now = new Date("2026-09-23T16:00:00Z").getTime();
const at = (iso: string) => new Date(iso).getTime();

describe("When a document's link was created", () => {
  test("reads to the minute", () => {
    expect(issuedLine(at("2026-09-01T17:05:00Z"), "en-US", zone)).toBe(
      "Link created Sep 1, 2026, 10:05 AM",
    );
  });
});

describe("Whether the customer has opened the link", () => {
  test("says so plainly when they have not", () => {
    expect(openedLine(0, undefined, now, "en-US", zone)).toBe("Not opened");
  });

  test("counts opens in words and names the day of the last one", () => {
    expect(openedLine(1, at("2026-09-23T15:00:00Z"), now, "en-US", zone)).toBe(
      "Opened once, today",
    );
    expect(openedLine(2, at("2026-09-23T06:00:00Z"), now, "en-US", zone)).toBe(
      "Opened twice, yesterday",
    );
    expect(openedLine(2, at("2026-09-21T20:00:00Z"), now, "en-US", zone)).toBe(
      "Opened twice, last Monday",
    );
    expect(openedLine(3, at("2026-09-17T20:00:00Z"), now, "en-US", zone)).toBe(
      "Opened 3 times, last Thursday",
    );
  });

  test("gives a date once the last open is a week or more back", () => {
    expect(openedLine(1, at("2026-09-16T20:00:00Z"), now, "en-US", zone)).toBe(
      "Opened once, Sep 16",
    );
    expect(openedLine(4, at("2026-09-02T20:00:00Z"), now, "en-US", zone)).toBe(
      "Opened 4 times, Sep 2",
    );
    expect(openedLine(1, at("2025-12-30T20:00:00Z"), now, "en-US", zone)).toBe(
      "Opened once, Dec 30, 2025",
    );
  });
});

describe("How a document was answered", () => {
  test("names the signer", () => {
    expect(
      decidedLine(
        { status: "signed", decidedAt: at("2026-09-01T17:00:00Z"), signerName: "Ada L" },
        "en-US",
        zone,
      ),
    ).toBe("Signed Sep 1, 2026 by Ada L");
  });

  test("gives the reason for a decline when there is one", () => {
    const declined = {
      status: "declined" as const,
      decidedAt: at("2026-09-01T17:00:00Z"),
    };
    expect(
      decidedLine({ ...declined, declineReason: "Too expensive" }, "en-US", zone),
    ).toBe("Declined Sep 1, 2026: Too expensive");
    expect(decidedLine({ ...declined, declineReason: "" }, "en-US", zone)).toBe(
      "Declined Sep 1, 2026",
    );
  });
});
