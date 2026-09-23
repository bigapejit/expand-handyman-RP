import { describe, expect, test } from "vitest";

import { proposalPdfFilename } from "./proposal-pdf";

describe("the PDF copy's filename", () => {
  test("names the offer by its Proposal ID", () => {
    expect(proposalPdfFilename("441094TH-P2")).toBe("Expand Handyman Proposal 441094TH-P2.pdf");
  });

  test("says when it is the signed copy", () => {
    expect(proposalPdfFilename("441094TH-P2", { signed: true })).toBe(
      "Expand Handyman Proposal 441094TH-P2 (signed).pdf",
    );
  });

  test("drops characters no file system takes", () => {
    expect(proposalPdfFilename('12/3:A*B?"C<D>|E\\F-P1')).toBe(
      "Expand Handyman Proposal 123ABCDEF-P1.pdf",
    );
    expect(proposalPdfFilename("  4410\tNE-P1\n")).toBe("Expand Handyman Proposal 4410 NE-P1.pdf");
  });
});
