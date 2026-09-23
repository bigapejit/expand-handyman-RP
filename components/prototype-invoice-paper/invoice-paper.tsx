// PROTOTYPE (issue #68): throwaway. The **Invoice paper** (CONTEXT.md) as
// settled on "Decide the invoice paper content and the invoice emails" (#66),
// drawn with the proposal paper's own classes (app/proposal-paper.css) and a
// few of its own (app/prototype/invoice-paper/prototype.css): one sheet, the
// letterhead on top, the cover block in the proposal's idiom, the lines, the
// Amount Due under the proposal's double rule, How to pay, and one line
// placing the invoice under the proposal's signed Terms. A PAID or VOID stamp
// lies across the sheet once the owner has marked it.

import { ExpandBusiness, letterheadContactLines } from "@/lib/expand-business";
import { formatCentsExact } from "@/lib/money";
import { paperSerifStack } from "@/lib/paper-fonts";
import { paperDate } from "@/lib/proposal-paper";

import { amountDueCents, type PaperInvoice } from "./fixtures";

export function InvoicePaper({
  invoice,
  footer = "page",
}: {
  invoice: PaperInvoice;
  footer?: "page" | "renderer";
}) {
  const key = invoice.number.replace(/\W/g, "").toLowerCase();
  const due = amountDueCents(invoice);
  const voided = invoice.voidedOn !== undefined;

  return (
    <article
      className={
        voided ? "proposal-document invoice-document ip-void" : "proposal-document invoice-document"
      }
      data-invoice={key}
      aria-label={`Invoice ${invoice.number}`}
    >
      {footer === "page" ? <InvoicePageRules pageKey={key} number={invoice.number} /> : null}

      <section className="pd-page ip-page">
        <Letterhead />

        <div className="ip-title">Invoice {invoice.number}</div>

        <CoverBlock invoice={invoice} />

        <table className="pd-qty ip-lines">
          <thead>
            <tr>
              <th>DESCRIPTION</th>
              <th className="pd-amount">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={index}>
                <td>{line.description}</td>
                <td className="pd-amount">{formatCentsExact(line.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="pd-grand ip-due">
          <table className="pd-grand-table">
            <tbody>
              <tr className="pd-grand-total">
                <th scope="row">Amount Due</th>
                <td className="ip-amount">{formatCentsExact(due)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="ip-pay">
          <div className="pd-scope-label">HOW TO PAY</div>
          <div className="pd-scope">
            <p>Due on receipt.</p>
            <p>
              Zelle: send to {invoice.zelleEmail}. The payment shows as{" "}
              {ExpandBusiness.letterheadName}.
            </p>
            <p>Check: payable to {ExpandBusiness.letterheadName}, handed to us in person.</p>
          </div>
        </div>

        <p className="ip-terms">
          Subject to the Terms and Conditions of Proposal {invoice.proposalCode} as signed.
        </p>

        {invoice.paidOn !== undefined ? (
          <div className="ip-stamp ip-stamp-paid" aria-label={`Paid ${paperDate(invoice.paidOn)}`}>
            Paid
            <small>{paperDate(invoice.paidOn)}</small>
          </div>
        ) : null}
        {invoice.voidedOn !== undefined ? (
          <div className="ip-stamp ip-stamp-void" aria-label={`Void ${paperDate(invoice.voidedOn)}`}>
            Void
            <small>{paperDate(invoice.voidedOn)}</small>
          </div>
        ) : null}
      </section>
    </article>
  );
}

// The proposal paper's letterhead, copied (components/proposal-paper.tsx does
// not export it).
function Letterhead() {
  return (
    <header className="pd-letterhead">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" width={403} height={345} />
      <div className="pd-letterhead-body">
        <div className="pd-letterhead-name">{ExpandBusiness.letterheadName}</div>
        <div className="pd-letterhead-lines">
          {letterheadContactLines().map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </div>
    </header>
  );
}

// The proposal's cover block, labels right and values left, with the
// invoice's facts in it.
function CoverBlock({ invoice }: { invoice: PaperInvoice }) {
  const rows: { label: string; values: string[]; spaced?: boolean }[] = [
    { label: "Date Sent", values: [paperDate(invoice.sentAt)] },
    { label: "Due", values: ["On receipt"] },
    { label: "Bill To", values: [invoice.customerName], spaced: true },
    { label: "Property", values: [invoice.site.street, invoice.site.city] },
    { label: "Proposal", values: [invoice.proposalCode], spaced: true },
    { label: "Name", values: [invoice.proposalName] },
  ];
  return (
    <table className="pd-facts ip-facts">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className={row.spaced ? "pd-fact-spaced" : undefined}>
            <th scope="row">{row.label}:</th>
            <td>
              {row.values.map((value, index) => (
                <span key={`${value}-${index}`} className="pd-fact-line">
                  <span>{value}</span>
                </span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The sheet's footer for a browser's print: the invoice number on the left and
// "Page: N" on the right, the way the proposal foots its own sheets with the
// Proposal ID (components/proposal-paper.tsx, ProposalPageRules).
function InvoicePageRules({ pageKey, number }: { pageKey: string; number: string }) {
  const name = `invoice${pageKey}`;
  const face = `font: 9.5pt ${paperSerifStack}; color: #000;`;
  const css =
    `@media print { @page ${name} {` +
    ` @bottom-left { content: ${JSON.stringify(number)}; ${face} }` +
    ` @bottom-center { content: none; }` +
    ` @bottom-right { content: "Page: " counter(page); ${face} }` +
    ` }` +
    ` html:has(.invoice-document),` +
    ` body:has(.invoice-document),` +
    ` .paper-screen,` +
    ` .invoice-document[data-invoice="${pageKey}"] { page: ${name}; } }`;
  return <style>{css}</style>;
}
