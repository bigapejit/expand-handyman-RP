import { describe, expect, it } from "vitest";

import { formatCents, formatCentsExact } from "./money";

describe("formatCents", () => {
  it("shows whole dollars without cents, and cents when there are any", () => {
    expect(formatCents(79_900, "en-US")).toBe("$799");
    expect(formatCents(79_950, "en-US")).toBe("$799.50");
  });
});

describe("formatCentsExact", () => {
  it("keeps both places, so a column of figures on paper lines up", () => {
    expect(formatCentsExact(79_900, "en-US")).toBe("$799.00");
    expect(formatCentsExact(79_950, "en-US")).toBe("$799.50");
    expect(formatCentsExact(0, "en-US")).toBe("$0.00");
  });
});
