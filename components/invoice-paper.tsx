import { Letterhead } from "@/components/proposal-paper";
import { ExpandBusiness } from "@/lib/expand-business";
import { invoiceMoney } from "@/lib/invoice-money";
import { invoiceTaxLabel, type PaperInvoice } from "@/lib/invoice-paper";
import { formatCentsExact } from "@/lib/money";
import { paperSerifStack } from "@/lib/paper-fonts";
import { paperDate } from "@/lib/proposal-paper";

// One invoice as paper: the **Invoice paper** (CONTEXT.md), as approved on the
// prototype (#68) and settled on "Decide the invoice paper content and the
// invoice emails" (#66). One sheet, drawn with the proposal paper's own
// classes (app/proposal-paper.css) and a few of its own
// (app/invoice-paper.css): the letterhead, the cover block in the proposal's
// idiom, the lines before tax, then Subtotal, Sales Tax and Amount Due under
// the proposal's double rule (Washington wants the tax stated separately, RCW
// 82.08.050), and How to pay. No Terms: the invoice sits under the proposal as
// signed, and the cover block already says Due: On receipt.
//
// Dates are read the way every date on the proposal paper is
// (lib/proposal-paper.ts, `paperDate`), so the two papers agree on the day.

export function InvoicePaper({ invoice }: { invoice: PaperInvoice }) {
  const key = invoice.number.replace(/\W/g, "").toLowerCase();
  const money = invoiceMoney(invoice.lines, invoice.taxRate);

  return (
    <article
      className="proposal-document invoice-document"
      data-invoice={key}
      aria-label={`Invoice ${invoice.number}`}
    >
      <InvoicePageRules pageKey={key} number={invoice.number} />

      <section className="pd-page">
        <Letterhead />

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
              <tr>
                <th scope="row">Subtotal</th>
                <td>{formatCentsExact(money.subtotalCents)}</td>
              </tr>
              <tr>
                <th scope="row">{invoiceTaxLabel(invoice.taxRate)}</th>
                <td>{formatCentsExact(money.taxCents)}</td>
              </tr>
              <tr className="pd-grand-total">
                <th scope="row">Amount Due</th>
                <td>{formatCentsExact(money.amountDueCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="ip-pay">
          <div className="pd-scope-label">HOW TO PAY</div>
          <div className="pd-scope">
            <p>
              Zelle: send to {invoice.zelleEmail}. The payment shows as{" "}
              {ExpandBusiness.letterheadName}.
            </p>
            <p>Check: payable to {ExpandBusiness.letterheadName}, handed to us in person.</p>
          </div>
        </div>
      </section>
    </article>
  );
}

// The proposal's cover block, labels right and values left, with the
// invoice's facts in it.
function CoverBlock({ invoice }: { invoice: PaperInvoice }) {
  const { street, city } = invoice.site;
  const rows: { label: string; values: string[]; spaced?: boolean }[] = [
    { label: "Invoice", values: [invoice.number] },
    { label: "Date Sent", values: [paperDate(invoice.sentAt)] },
    { label: "Due", values: ["On receipt"] },
    { label: "Bill To", values: [invoice.customerName], spaced: true },
    { label: "Property", values: city ? [street, city] : [street] },
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
// "Page: N" on the right, the way the proposal foots its sheets with the
// Proposal ID (components/proposal-paper.tsx, ProposalPageRules), and named
// after the invoice for the same reason: Chrome varies margin boxes only by
// page name, and the name has to run up the ancestors.
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
