import { describe, expect, it } from "vitest";

import { invoiceStanding, isCalendarDay, pacificDay } from "./invoice-standing";

// A moment given as Pacific wall-clock time. PDT is UTC-7, PST is UTC-8.
const pdt = (y: number, m: number, d: number, h = 12, min = 0) =>
  Date.UTC(y, m - 1, d, h + 7, min);
const pst = (y: number, m: number, d: number, h = 12, min = 0) =>
  Date.UTC(y, m - 1, d, h + 8, min);

const sent = (sentAt: number, amountDueCents = 29_948) => ({
  state: "sent" as const,
  sentAt,
  amountDueCents,
  hasPayment: false,
});

describe("The Pacific day", () => {
  it("is the calendar day in Pacific time, not UTC", () => {
    // 8:30pm Pacific on 23 September is already the 24th in UTC.
    expect(pacificDay(pdt(2026, 9, 23, 20, 30))).toBe("2026-09-23");
    expect(pacificDay(pdt(2026, 9, 24, 0, 0))).toBe("2026-09-24");
    expect(pacificDay(pst(2026, 1, 5, 23, 59))).toBe("2026-01-05");
  });

  it("knows a day written as YYYY-MM-DD from anything else", () => {
    expect(isCalendarDay("2026-09-23")).toBe(true);
    expect(isCalendarDay("2026-9-23")).toBe(false);
    expect(isCalendarDay("2026-02-30")).toBe(false);
    expect(isCalendarDay("")).toBe(false);
  });
});

describe("An invoice's standing", () => {
  it("is Unpaid once sent, and still Unpaid seven full days on", () => {
    const at = pdt(2026, 9, 1, 9);
    expect(invoiceStanding(sent(at), "2026-09-01")).toBe("unpaid");
    expect(invoiceStanding(sent(at), "2026-09-08")).toBe("unpaid");
  });

  it("turns Overdue on the ninth for an invoice sent on the first, at any hour of it", () => {
    for (const at of [pdt(2026, 9, 1, 0, 0), pdt(2026, 9, 1, 23, 59)]) {
      expect(invoiceStanding(sent(at), "2026-09-08")).toBe("unpaid");
      expect(invoiceStanding(sent(at), "2026-09-09")).toBe("overdue");
      expect(invoiceStanding(sent(at), "2026-10-30")).toBe("overdue");
    }
  });

  it("reads the sent day in Pacific time, so a late-evening send counts from that evening's day", () => {
    // 11pm Pacific on the 1st is the 2nd in UTC.
    const at = pdt(2026, 9, 1, 23);
    expect(invoiceStanding(sent(at), pacificDay(pdt(2026, 9, 8, 23, 59)))).toBe("unpaid");
    expect(invoiceStanding(sent(at), pacificDay(pdt(2026, 9, 9, 0, 0)))).toBe("overdue");
  });

  it("keeps the boundary at Pacific midnight across the end of daylight time", () => {
    // Sent half an hour into 1 November 2026, before clocks go back at 2am.
    const at = pdt(2026, 11, 1, 0, 30);
    expect(invoiceStanding(sent(at), pacificDay(pst(2026, 11, 8, 23, 59)))).toBe("unpaid");
    expect(invoiceStanding(sent(at), pacificDay(pst(2026, 11, 9, 0, 0)))).toBe("overdue");
  });

  it("keeps the boundary at Pacific midnight across the start of daylight time", () => {
    // Sent late on 1 March 2026, PST; daylight time starts on the 8th.
    const at = pst(2026, 3, 1, 23, 30);
    expect(invoiceStanding(sent(at), pacificDay(pdt(2026, 3, 8, 23, 59)))).toBe("unpaid");
    expect(invoiceStanding(sent(at), pacificDay(pdt(2026, 3, 9, 0, 0)))).toBe("overdue");
  });

  it("is Paid from the moment it is sent when nothing is due", () => {
    const at = pdt(2026, 9, 1);
    expect(invoiceStanding(sent(at, 0), "2026-09-01")).toBe("paid");
    expect(invoiceStanding(sent(at, 0), "2026-12-01")).toBe("paid");
  });

  it("is Paid once a payment is recorded, however late", () => {
    const at = pdt(2026, 9, 1);
    expect(invoiceStanding({ ...sent(at), hasPayment: true }, "2026-12-01")).toBe("paid");
  });

  it("leaves a credit Unpaid until it is marked paid", () => {
    const at = pdt(2026, 9, 1);
    expect(invoiceStanding(sent(at, -8_000), "2026-09-02")).toBe("unpaid");
    expect(invoiceStanding(sent(at, -8_000), "2026-09-09")).toBe("overdue");
  });

  it("is nothing for a draft or a void invoice", () => {
    const at = pdt(2026, 9, 1);
    expect(
      invoiceStanding({ state: "draft", amountDueCents: 0, hasPayment: false }, "2026-09-20"),
    ).toBeNull();
    expect(invoiceStanding({ ...sent(at), state: "void" }, "2026-09-20")).toBeNull();
    expect(invoiceStanding({ ...sent(at, 0), state: "void", hasPayment: true }, "2026-09-20")).toBeNull();
  });
});
