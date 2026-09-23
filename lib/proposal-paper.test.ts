import { describe, expect, it } from "vitest";

import {
  GrandTotalLines,
  SolutionLinesPerSheet,
  paperDate,
  paperScale,
  paperTitle,
  solutionLines,
  solutionSheets,
  validUntil,
  type PaperSolution,
} from "./proposal-paper";

// The paper's own dates, the chrome's sentences, and how the solutions are
// laid out across sheets. Ported from FRSG's lib/proposal-paper.test.ts, with
// Expand's pagination fix: the Grand Total is counted in the last sheet.

// A solution with a one-line scope and `items` line items. Its estimate is
// 13 lines plus 1.3 a line item, rounded up.
function solution(id: string, items: number): PaperSolution {
  return {
    solutionId: id,
    title: `Solution ${id}`,
    scopeOfWork: "Do the work.",
    lineItems: Array.from({ length: items }, (_, index) => ({
      name: `Line ${index + 1}`,
      quantity: 1,
      unit: "EA" as const,
    })),
  };
}

const ids = (sheets: PaperSolution[][]) =>
  sheets.map((sheet) => sheet.map((each) => each.solutionId));

describe("the paper's dates", () => {
  it("prints a day in UTC, whatever the reader's timezone", () => {
    expect(paperDate(Date.UTC(2026, 8, 2, 23, 30))).toBe("9/2/2026");
  });

  it("stands the offer for thirty days from the day it was sent", () => {
    expect(paperDate(validUntil(Date.UTC(2026, 8, 2)))).toBe("10/2/2026");
  });
});

describe("the top bar", () => {
  it("names the proposal by its number and its name", () => {
    expect(paperTitle(2, "Kitchen faucet")).toBe("Proposal 2 · Kitchen faucet");
  });
});

describe("fitting a letter page to the box it is drawn in", () => {
  it("keeps the sheet at full size wherever there is room for the whole paper", () => {
    expect(paperScale(1280)).toBe(1);
  });

  it("shrinks it to the room there is on a phone", () => {
    expect(paperScale(390)).toBeCloseTo((390 - 20) / (8.5 * 96), 5);
  });

  it("never scales to nothing, whatever it is given", () => {
    expect(paperScale(0)).toBeGreaterThan(0);
  });
});

describe("estimating a solution's lines", () => {
  it("counts its head, its line items and its scope", () => {
    expect(solutionLines(solution("a", 0))).toBe(13);
    expect(solutionLines(solution("a", 10))).toBe(26);
  });

  it("wraps a long scope paragraph at about 122 characters", () => {
    const long = { ...solution("a", 0), scopeOfWork: "x".repeat(250) };
    expect(solutionLines(long)).toBe(15);
  });
});

describe("laying the solutions out across sheets", () => {
  it("keeps the Grand Total on the sheet with the solutions when there is room", () => {
    const sheets = solutionSheets([solution("a", 0), solution("b", 0)]);
    expect(ids(sheets)).toEqual([["a", "b"]]);
  });

  it("starts a fresh sheet when the solutions outrun one", () => {
    // 20 + 20 fit together; the third, with the Grand Total, needs its own.
    const sheets = solutionSheets([solution("a", 6), solution("b", 6), solution("c", 6)]);
    expect(ids(sheets)).toEqual([["a", "b"], ["c"]]);
  });

  it("takes the last solution onto a fresh sheet rather than leave the Grand Total behind", () => {
    // 13 + 26 = 39 fits a sheet, but not with the Grand Total's 14 lines.
    expect(13 + 26 + GrandTotalLines).toBeGreaterThan(SolutionLinesPerSheet);
    const sheets = solutionSheets([solution("a", 0), solution("b", 10)]);
    expect(ids(sheets)).toEqual([["a"], ["b"]]);
  });

  it("gives the Grand Total a lettered sheet of its own after one solution that fills a sheet", () => {
    const sheets = solutionSheets([solution("a", 20)]);
    expect(ids(sheets)).toEqual([["a"], []]);
  });

  it("gives the Grand Total its own sheet when the solution it would take along is too long for both", () => {
    // 13 + 35 fill a sheet exactly; 35 + 14 would still overrun one.
    const long = { ...solution("b", 16), scopeOfWork: "x".repeat(200) };
    expect(solutionLines(long)).toBe(35);
    const sheets = solutionSheets([solution("a", 0), long]);
    expect(ids(sheets)).toEqual([["a", "b"], []]);
  });

  it("still gives a proposal with no solutions a sheet for its Grand Total", () => {
    expect(ids(solutionSheets([]))).toEqual([[]]);
  });
});
