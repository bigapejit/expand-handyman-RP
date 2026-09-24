import { describe, expect, test } from "vitest";

import { invoicePdfCopyFilename, pdfCopyFilename } from "./pdf-copy";

describe("the PDF copy's filename", () => {
  test("names the offer by its Proposal ID", () => {
    expect(pdfCopyFilename("441094TH-P2")).toBe("Expand Handyman Proposal 441094TH-P2.pdf");
  });

  test("says when it is the signed copy", () => {
    expect(pdfCopyFilename("441094TH-P2", { signed: true })).toBe(
      "Expand Handyman Proposal 441094TH-P2 (signed).pdf",
    );
  });

  test("drops characters no file system takes", () => {
    expect(pdfCopyFilename('12/3:A*B?"C<D>|E\F-P1')).toBe(
      "Expand Handyman Proposal 123ABCDEF-P1.pdf",
    );
    expect(pdfCopyFilename("  4410\tNE-P1\n")).toBe("Expand Handyman Proposal 4410 NE-P1.pdf");
  });
});

describe("an invoice's PDF copy's filename", () => {
  test("names the invoice by its number, sent or paid alike", () => {
    expect(invoicePdfCopyFilename("INV-1001")).toBe("Expand Handyman Invoice INV-1001.pdf");
  });

  test("says when the invoice is void", () => {
    expect(invoicePdfCopyFilename("INV-1003", { void: true })).toBe(
      "Expand Handyman Invoice INV-1003 (void).pdf",
    );
  });

  test("drops characters no file system takes", () => {
    expect(invoicePdfCopyFilename('INV/10:0*1?"<>|\\')).toBe("Expand Handyman Invoice INV1001.pdf");
    expect(invoicePdfCopyFilename(" INV-\t1001\n")).toBe("Expand Handyman Invoice INV- 1001.pdf");
  });
});
