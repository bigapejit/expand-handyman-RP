import { describe, expect, it } from "vitest";

import {
  OPEN_STAGES,
  STAGE_LABELS,
  attention,
  calendarUrl,
  dealValueCents,
  firstLine,
  money,
  notesFault,
  readBallpark,
  stageOnCustomerReply,
  stageOnProposalApproved,
  stageOnProposalSent,
  titleFault,
} from "./pipeline";

describe("what the owner types", () => {
  it("wants a job, under 200 characters", () => {
    expect(titleFault("  Fence repair ")).toBeNull();
    expect(titleFault("   ")).toBe("Say what the job is.");
    expect(titleFault("x".repeat(200))).toBeNull();
    expect(titleFault("x".repeat(201))).toBe("Keep the job under 200 characters.");
  });

  it("keeps notes under 5,000 characters, and blank is fine", () => {
    expect(notesFault("")).toBeNull();
    expect(notesFault("x".repeat(5000))).toBeNull();
    expect(notesFault("x".repeat(5001))).toBe("Keep notes under 5,000 characters.");
  });
});

describe("stages", () => {
  it("moves to Talking when the customer answers the owner, and only from New", () => {
    expect(stageOnCustomerReply("new", true)).toBe("talking");
    expect(stageOnCustomerReply("new", false)).toBe("new");
    for (const stage of ["talking", "booked", "estimating", "quoted", "won", "lost"] as const)
      expect(stageOnCustomerReply(stage, true)).toBe(stage);
  });

  it("moves to Sent out on a sent proposal, never back", () => {
    for (const stage of ["new", "talking", "booked", "estimating"] as const)
      expect(stageOnProposalSent(stage)).toBe("quoted");
    for (const stage of ["quoted", "won", "lost"] as const)
      expect(stageOnProposalSent(stage)).toBe(stage);
  });

  it("moves to Won on an approved proposal, but not out of Lost", () => {
    for (const stage of ["new", "talking", "booked", "estimating", "quoted"] as const)
      expect(stageOnProposalApproved(stage)).toBe("won");
    expect(stageOnProposalApproved("won")).toBe("won");
    expect(stageOnProposalApproved("lost")).toBe("lost");
  });

  it("labels every stage and leaves Won and Lost off the open ones", () => {
    expect(Object.values(STAGE_LABELS)).toEqual([
      "New",
      "Talking",
      "Booked",
      "Estimating",
      "Sent out",
      "Won",
      "Lost",
    ]);
    expect(OPEN_STAGES).toEqual(["new", "talking", "booked", "estimating", "quoted"]);
  });
});

describe("attention", () => {
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 8, 23, 18, 0);
  const deal = (
    stage: Parameters<typeof attention>[0]["stage"],
    days: number,
    proposal: Parameters<typeof attention>[0]["proposal"] = null,
  ) => ({ stage, stageChangedAt: now - days * DAY, proposal });
  // A proposal sent `days` ago.
  const out = (days: number, opened = false, state: "sent" | "approved" = "sent") => ({
    state,
    opened,
    sentAt: now - days * DAY,
  });

  it("flags a deal left too long in its stage", () => {
    expect(attention(deal("new", 1), now)).toBe("No reply yet");
    expect(attention(deal("talking", 4), now)).toBe("Gone quiet");
    expect(attention(deal("estimating", 3), now)).toBe("Estimate overdue");
    expect(attention(deal("quoted", 9, out(9)), now)).toBe("Sent 9 days ago");
  });

  it("says nothing while a deal is still fresh in its stage", () => {
    expect(attention(deal("new", 0.9), now)).toBeNull();
    expect(attention(deal("talking", 3.9), now)).toBeNull();
    expect(attention(deal("estimating", 2.9), now)).toBeNull();
    expect(attention(deal("quoted", 6.9, out(6.9)), now)).toBeNull();
    // Booked waits on the visit, which is on the calendar.
    expect(attention(deal("booked", 30), now)).toBeNull();
  });

  it("flags a proposal the customer opened and has not answered", () => {
    expect(attention(deal("quoted", 2, out(2, true)), now)).toBe("Opened, no answer");
    // A week out says more than the open does.
    expect(attention(deal("quoted", 8, out(8, true)), now)).toBe("Sent 8 days ago");
  });

  it("counts Sent out from the latest send, not from the move", () => {
    // Sent out for 20 days, and a fresh proposal went out yesterday.
    expect(attention(deal("quoted", 20, out(1)), now)).toBeNull();
    expect(attention(deal("quoted", 20, out(10)), now)).toBe("Sent 10 days ago");
  });

  it("counts a deal moved to Sent out by hand, with no proposal, from the move", () => {
    expect(attention(deal("quoted", 20), now)).toBe("Sent 20 days ago");
    expect(attention(deal("quoted", 6), now)).toBeNull();
  });

  it("says nothing on Sent out once the proposal is decided", () => {
    expect(attention(deal("quoted", 20, out(20, true, "approved")), now)).toBeNull();
  });

  it("never flags Won or Lost", () => {
    expect(attention(deal("won", 30), now)).toBeNull();
    expect(attention(deal("lost", 30), now)).toBeNull();
  });
});

describe("calendarUrl", () => {
  const deal = {
    title: "Fence repair",
    customerName: "Maria Delgado",
    phone: "(360) 555-0187",
    notes: "  Gate code 1234\nDog in the yard  ",
    siteLine: "8907 NE 15th St, Vancouver, WA 98664",
  };

  it("prefills a one-hour event at the next full hour", () => {
    const at = new Date(2026, 8, 23, 14, 25, 10);
    const url = new URL(calendarUrl(deal, at.getTime()));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    const start = new Date(2026, 8, 23, 15, 0, 0);
    const end = new Date(2026, 8, 23, 16, 0, 0);
    const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: "TEMPLATE",
      text: "Fence repair · Maria Delgado",
      dates: `${stamp(start)}/${stamp(end)}`,
      details: "Maria Delgado\n(360) 555-0187\nGate code 1234\nDog in the yard",
      location: "8907 NE 15th St, Vancouver, WA 98664",
    });
  });

  it("moves on an hour from a time already on the hour", () => {
    const at = new Date(2026, 8, 23, 14, 0, 0);
    const dates = new URL(calendarUrl(deal, at.getTime())).searchParams.get("dates");
    expect(dates?.split("/")[0]).toBe(
      new Date(2026, 8, 23, 15, 0, 0).toISOString().replace(/[-:]|\.\d{3}/g, ""),
    );
  });

  it("leaves out a location and blank details when the deal has none", () => {
    const url = new URL(
      calendarUrl({ ...deal, phone: "", notes: "", siteLine: null }, Date.UTC(2026, 8, 23)),
    );
    expect(url.searchParams.has("location")).toBe(false);
    expect(url.searchParams.get("details")).toBe("Maria Delgado");
  });
});

describe("readBallpark", () => {
  it("reads whole dollars, with or without the sign and commas", () => {
    expect(readBallpark("")).toEqual({ cents: null });
    expect(readBallpark("  ")).toEqual({ cents: null });
    expect(readBallpark("$1,200")).toEqual({ cents: 120_000 });
    expect(readBallpark("850")).toEqual({ cents: 85_000 });
  });

  it("refuses cents, zero and words", () => {
    for (const typed of ["12.50", "0", "about 500", "-5"])
      expect(readBallpark(typed)).toHaveProperty("fault");
  });
});

describe("money and value", () => {
  it("prints whole dollars", () => {
    expect(money(185_000)).toBe("$1,850");
    expect(money(12_345)).toBe("$123");
  });

  it("prefers the proposal's total to the ballpark", () => {
    expect(dealValueCents({ ballparkCents: 50_000, proposal: { totalCents: 61_234 } })).toBe(61_234);
    expect(dealValueCents({ ballparkCents: 50_000, proposal: null })).toBe(50_000);
    expect(dealValueCents({ proposal: null })).toBeNull();
  });
});

describe("firstLine", () => {
  it("is the first line with something on it", () => {
    expect(firstLine("\n  Gate code 1234\nDog")).toBe("Gate code 1234");
    expect(firstLine("  \n ")).toBe("");
  });
});
