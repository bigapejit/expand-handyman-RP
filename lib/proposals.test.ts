import { describe, expect, it } from "vitest";

import {
  lastChangeLine,
  moveInOrder,
  proposalActivity,
  proposalCode,
  proposalPanelHref,
  proposalStateLabel,
  readPercentField,
  readTaxRateField,
  reorder,
  solutionPickLabel,
  splitFieldValue,
  taxRateField,
  taxSourceLine,
} from "./proposals";

describe("How a Proposal's state reads", () => {
  it("names every state a Proposal can be in", () => {
    expect(proposalStateLabel("draft")).toBe("Draft");
    expect(proposalStateLabel("sent")).toBe("Sent");
    expect(proposalStateLabel("approved")).toBe("Approved");
    expect(proposalStateLabel("declined")).toBe("Declined");
  });
});

describe("The Proposal ID", () => {
  it("joins the Site name and the number", () => {
    expect(proposalCode("441094TH", 1)).toBe("441094TH-P1");
    expect(proposalCode("1215MAIN", 12)).toBe("1215MAIN-P12");
  });
});

describe("Where a Proposal row points", () => {
  it("opens the panel on the customer's Proposals tab", () => {
    expect(proposalPanelHref("c1", "p1")).toBe("/customers/c1/proposals?proposal=p1");
  });
});

describe("What the Customers list says about a customer's proposals", () => {
  const at = (state: "draft" | "sent" | "approved" | "declined", updatedAt = 0) => ({
    state,
    updatedAt,
  });

  it("says so when there are none", () => {
    expect(proposalActivity([])).toEqual({ kind: "quiet", label: "No proposals" });
  });

  it("counts drafts being written", () => {
    expect(proposalActivity([at("draft")])).toEqual({ kind: "quiet", label: "1 draft" });
    expect(proposalActivity([at("draft"), at("draft")])).toEqual({
      kind: "quiet",
      label: "2 drafts",
    });
  });

  it("puts the Sent ones waiting on the customer first", () => {
    expect(proposalActivity([at("approved", 5), at("sent"), at("draft")])).toEqual({
      kind: "awaiting",
      label: "1 awaiting a signature",
    });
    expect(proposalActivity([at("sent"), at("sent")])).toEqual({
      kind: "awaiting",
      label: "2 awaiting a signature",
    });
  });

  it("otherwise names how the latest decision went", () => {
    expect(proposalActivity([at("declined", 1), at("approved", 2), at("draft", 3)])).toEqual({
      kind: "decided",
      state: "approved",
    });
    expect(proposalActivity([at("declined", 2), at("approved", 1)])).toEqual({
      kind: "decided",
      state: "declined",
    });
  });
});

describe("How a Solution reads in the picker", () => {
  it("names it with its price", () => {
    expect(solutionPickLabel(700_000, "en-US")).toBe("$7,000");
  });

  // Pickable, and flagged: a Draft may hold an unpriced Solution, and only
  // Send minds.
  it("flags one nobody has costed", () => {
    expect(solutionPickLabel(null, "en-US")).toBe("No price");
  });
});

describe("Where the tax rate came from", () => {
  it("cites DOR's location code and quarter", () => {
    expect(
      taxSourceLine({
        source: "lookup",
        rate: 0.089,
        locationCode: "0605",
        period: "Q32026",
      }),
    ).toBe("Looked up · location 0605 · Q32026");
  });

  it("cites what it has, when DOR gave no quarter", () => {
    expect(taxSourceLine({ source: "lookup", rate: 0.089, locationCode: "0605" })).toBe(
      "Looked up · location 0605",
    );
  });

  // The location code is a fact about the Site's address and survives an
  // override; the quarter dates DOR's figure, and a typed one is nobody's.
  it("says a rate was typed by hand, and still names the location", () => {
    expect(taxSourceLine({ source: "override", rate: 0.065 })).toBe("Entered by hand");
    expect(taxSourceLine({ source: "override", rate: 0.065, locationCode: "0605" })).toBe(
      "Entered by hand · location 0605",
    );
  });

  // A Washington Site whose lookup found nothing needs a rate, and saying so
  // is the only way to get one.
  it("asks for a rate when the lookup found none", () => {
    expect(taxSourceLine({ source: "lookup" })).toBe("No rate found — enter the rate");
  });

  it("says nothing at all outside Washington", () => {
    expect(taxSourceLine({ source: "none" })).toBeNull();
  });
});

describe("The rate field", () => {
  it("shows a decimal rate as the percent people talk in", () => {
    expect(taxRateField(0.089)).toBe("8.9");
    expect(taxRateField(0.065)).toBe("6.5");
    expect(taxRateField(undefined)).toBe("");
  });

  it("reads a typed percent back as a decimal of the whole", () => {
    expect(readTaxRateField("8.9")).toBe(0.089);
    expect(readTaxRateField(" 8.9% ")).toBe(0.089);
    expect(readTaxRateField("0")).toBe(0);
  });

  // A field being typed into is half-written most of the time, and nothing
  // half-written is a rate worth storing.
  it("reads a half-typed field as nothing yet", () => {
    expect(readTaxRateField("")).toBeNull();
    expect(readTaxRateField("8.")).toBe(0.08);
    expect(readTaxRateField("abc")).toBeNull();
  });
});

describe("The two linked percent fields", () => {
  it("shows the deposit and the remainder", () => {
    expect(splitFieldValue(25)).toEqual({ deposit: "25", final: "75" });
  });

  it("reads a whole percent, and nothing else", () => {
    expect(readPercentField("25")).toBe(25);
    expect(readPercentField(" 25 ")).toBe(25);
    expect(readPercentField("")).toBeNull();
    expect(readPercentField("25.5")).toBeNull();
    expect(readPercentField("abc")).toBeNull();
  });
});

describe("Ordering the Solutions a Proposal offers", () => {
  it("moves a row to where it was dropped", () => {
    expect(reorder(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("is nothing happening when a row is dropped where it already is", () => {
    expect(reorder(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  it("ignores a drop that names no row", () => {
    expect(reorder(["a", "b", "c"], -1, 1)).toEqual(["a", "b", "c"]);
    expect(reorder(["a", "b", "c"], 0, 9)).toEqual(["a", "b", "c"]);
  });

  it("swaps a row with its neighbour", () => {
    expect(moveInOrder(["a", "b", "c"], 1, "up")).toEqual(["b", "a", "c"]);
    expect(moveInOrder(["a", "b", "c"], 1, "down")).toEqual(["a", "c", "b"]);
    expect(moveInOrder(["a", "b", "c"], 0, "up")).toEqual(["a", "b", "c"]);
    expect(moveInOrder(["a", "b", "c"], 2, "down")).toEqual(["a", "b", "c"]);
  });
});

describe("The last change to a Proposal", () => {
  it("names the day", () => {
    expect(lastChangeLine(Date.UTC(2026, 8, 2, 18), "en-US")).toBe("Last edited Sep 2, 2026");
  });
});
