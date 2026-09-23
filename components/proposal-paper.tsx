import {
  ExpandBusiness,
  ExpandProposalTerms,
  letterheadContactLines,
} from "@/lib/expand-business";
import { formatCentsExact } from "@/lib/money";
import { paperSerifStack } from "@/lib/paper-fonts";
import {
  ValidityDays,
  paperDate,
  scopeLines,
  solutionSheets,
  validUntil,
  type PaperProposal,
  type PaperSolution,
} from "@/lib/proposal-paper";
import { splitPayment, type ProposalTax } from "@/lib/proposal-pricing";

// One proposal as paper: the **Proposal paper** (CONTEXT.md). FRSG's
// components/roof-report/proposal-document.tsx copied line for line, with the
// changes settled on "Decide the proposal paper content for Expand" (#18) and
// approved on the prototype (#22): Expand's letterhead and wording, no sketch
// pages or sketch markers, and a Terms and Conditions page after the Grand
// Total.
//
// Page order: the cover (letterhead, cover block, the opening letter, the
// accept line and the two signature lines), the solution sheets with the Grand
// Total closing the last, then the Terms. The only money on the paper is the
// Grand Total block: a solution carries no price of its own.
//
// Every moment on the paper is read in UTC (lib/proposal-paper.ts), so the day
// beside a signature is the same day wherever the paper is read.
export function ProposalPaper({ proposal }: { proposal: PaperProposal }) {
  const sheets = solutionSheets(proposal.solutions);

  return (
    <article
      className="proposal-document"
      data-proposal={proposal.number}
      aria-label={`Proposal ${proposal.number}`}
    >
      <ProposalPageRules number={proposal.number} code={proposal.code} />

      <section className="pd-page">
        <Letterhead />
        <CoverBlock proposal={proposal} />
        <Letter proposal={proposal} />
        <AgreeAndSign proposal={proposal} />
      </section>

      {sheets.map((group, index) => (
        <section className="pd-page" key={index}>
          <Letterhead />
          {group.map((solution) => (
            <SolutionBlock key={solution.solutionId} solution={solution} />
          ))}
          {index === sheets.length - 1 ? <GrandTotal proposal={proposal} /> : null}
        </section>
      ))}

      <TermsPage />
    </article>
  );
}

// The letterhead, at the top of every block that starts a page. It is repeated
// rather than fixed to the sheet because a `position: fixed` running header
// repeats on every printed page in some browsers and on the first page only in
// others, and this document is the deliverable.
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

// The footer, and which sheets it goes on: the Proposal ID on the left and
// "Page: N" on the right.
//
// Chrome draws page-margin boxes on every printed sheet, and the only way to
// vary them is by the sheet's page name, so the proposal names its sheets
// after its number. The name has to run up the ancestors too: Chrome closes a
// job with an empty sheet whenever their page name disagrees with the last
// sheet's.
function ProposalPageRules({ number, code }: { number: number; code: string }) {
  const name = `proposal${number}`;
  const face = `font: 9.5pt ${paperSerifStack}; color: #000;`;
  const css =
    `@media print { @page ${name} {` +
    ` @bottom-left { content: ${JSON.stringify(code)}; ${face} }` +
    ` @bottom-center { content: none; }` +
    ` @bottom-right { content: "Page: " counter(page); ${face} }` +
    ` }` +
    ` html:has(.proposal-document),` +
    ` body:has(.proposal-document),` +
    ` .paper-screen,` +
    ` .proposal-document[data-proposal="${number}"] { page: ${name}; } }`;
  return <style>{css}</style>;
}

type CoverRow = { label: string; values: string[]; trailing?: string; spaced?: boolean };

// Belfor's cover block: labels right, values left, in three groups. The Client
// is the customer's name alone, and the Estimator's number is the business's.
function CoverBlock({ proposal }: { proposal: PaperProposal }) {
  const rows: CoverRow[] = [
    { label: "Client", values: [proposal.customerName] },
    { label: "Property", values: siteLines(proposal) },
    {
      label: "Estimator",
      values: [proposal.estimator.name],
      trailing: `Business: ${ExpandBusiness.phone}`,
      spaced: true,
    },
    {
      label: "Position",
      values: ["Estimator"],
      trailing: `E-mail: ${proposal.estimator.email}`,
    },
    { label: "Company", values: [ExpandBusiness.company] },
    { label: "Business", values: [ExpandBusiness.serviceArea] },
    { label: "Type of Proposal", values: ["Handyman services"], spaced: true },
    { label: "Date Sent", values: [paperDate(proposal.sentAt)] },
    { label: "Valid Until", values: [paperDate(validUntil(proposal.sentAt))] },
    { label: "Proposal", values: [proposal.code], spaced: true },
    { label: "Name", values: [proposal.name] },
    { label: "Recommended", values: [proposal.recommended ? "Yes" : "No"] },
  ];

  return (
    <table className="pd-facts">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className={row.spaced ? "pd-fact-spaced" : undefined}>
            <th scope="row">{row.label}:</th>
            <td>
              {row.values.map((value, index) => (
                <span key={`${value}-${index}`} className="pd-fact-line">
                  <span>{value}</span>
                  {index === 0 && row.trailing ? <span>{row.trailing}</span> : null}
                </span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The fixed letter. Its wording is Expand's, not the owner's: the only part of
// it anyone writes is the **Notes and exclusions** paragraph, which sits in it
// without a heading of its own and is simply absent when empty.
function Letter({ proposal }: { proposal: PaperProposal }) {
  return (
    <div className="pd-narrative">
      <p>
        We would like to thank you for the opportunity to provide you with this proposal. The
        total cost for the work detailed in the following proposal is{" "}
        <span className="pd-total">{formatCentsExact(proposal.totalCents)}</span>.{" "}
        {taxSentence(proposal)}
      </p>
      <p>
        This proposal covers {joinTitles(proposal.solutions.map((solution) => solution.title))} at{" "}
        {proposal.site.street}. Each item of work is described on the following pages, with the
        materials and labor it includes.
      </p>
      {proposal.notes ? <p>{proposal.notes}</p> : null}
      <p>
        This proposal is valid for {ValidityDays} days from {paperDate(proposal.sentAt)}. If you
        have any questions about this proposal, please contact {proposal.estimator.name} at{" "}
        {ExpandBusiness.phone} to discuss those questions.
      </p>
    </div>
  );
}

// The two signature lines. Send is Expand's offer and nobody at Expand
// countersigns, so the Expand Handyman Representative line is filled the
// moment the proposal is sent: the Estimator's name in the script face, with
// the sent date. The customer's line is blank until they sign.
function AgreeAndSign({ proposal }: { proposal: PaperProposal }) {
  return (
    <div className="pd-agree">
      <p>
        I/we agree to the terms and conditions of this proposal, including the Terms and
        Conditions page.
      </p>
      <div className="pd-signatures">
        <SignatureLine label="Owner/Authorized Signature" />
        <SignatureLine
          label="Expand Handyman Representative"
          name={proposal.estimator.name}
          date={paperDate(proposal.sentAt)}
        />
      </div>
    </div>
  );
}

function SignatureLine({
  label,
  name = null,
  date = null,
}: {
  label: string;
  name?: string | null;
  date?: string | null;
}) {
  return (
    <div className="pd-signature">
      <div className="pd-signature-row">
        <span className="pd-signature-rule">
          {name ? <span className="pd-script">{name}</span> : null}
        </span>
        <span className="pd-signature-date">
          Date<span className="pd-date-rule">{date}</span>
        </span>
      </div>
      <div className="pd-signature-label">{label}</div>
    </div>
  );
}

// One solution: what it is built from, and what it does. No price — the Grand
// Total block is the only money on the paper.
function SolutionBlock({ solution }: { solution: PaperSolution }) {
  return (
    <div className="pd-solution">
      <div className="pd-solution-head">
        <span>{solution.title}</span>
      </div>
      {solution.lineItems.length > 0 ? (
        <table className="pd-qty">
          <thead>
            <tr>
              <th>DESCRIPTION</th>
              <th className="pd-amount">QTY</th>
            </tr>
          </thead>
          <tbody>
            {solution.lineItems.map((line, index) => (
              <tr key={index}>
                <td>{line.name}</td>
                <td className="pd-amount">{quantityLabel(line.quantity, line.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="pd-scope-label">SCOPE OF WORK</div>
      <div className="pd-scope">
        {scopeLines(solution.scopeOfWork).map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>
    </div>
  );
}

// Belfor's closing figure: the Payment Terms as amounts, the tax rows only
// where tax is charged, the Grand Total under a double rule, and the
// Estimator's signature under it.
function GrandTotal({ proposal }: { proposal: PaperProposal }) {
  const payment = splitPayment(proposal.totalCents, proposal.depositPercent);
  const taxed = proposal.tax.source !== "none";
  const estimator = proposal.estimator.name;

  return (
    <div className="pd-grand">
      <table className="pd-grand-table">
        <tbody>
          {payment.depositPercent > 0 ? (
            <tr>
              <th scope="row">{payment.depositPercent}% due on signing</th>
              <td>{formatCentsExact(payment.depositCents)}</td>
            </tr>
          ) : null}
          {payment.finalPercent > 0 ? (
            <tr>
              <th scope="row">{payment.finalPercent}% due on completion</th>
              <td>{formatCentsExact(payment.finalCents)}</td>
            </tr>
          ) : null}
          {taxed ? (
            <tr>
              <th scope="row">Subtotal</th>
              <td>{formatCentsExact(proposal.subtotalCents)}</td>
            </tr>
          ) : null}
          {taxed ? (
            <tr>
              <th scope="row">{taxLabel(proposal.tax)}</th>
              <td>{formatCentsExact(proposal.taxCents)}</td>
            </tr>
          ) : null}
          <tr className="pd-grand-total">
            <th scope="row">Grand Total</th>
            <td>{formatCentsExact(proposal.totalCents)}</td>
          </tr>
        </tbody>
      </table>
      <div className="pd-estimator">
        <div className="pd-estimator-rule">
          <span className="pd-script">{estimator}</span>
        </div>
        <div>{estimator}</div>
        <div>Estimator</div>
      </div>
    </div>
  );
}

// Expand's own sheet, which FRSG's paper has none of: the **Terms** in full,
// letterhead on top, after the Grand Total. The id is what "Read the Terms"
// scrolls to.
function TermsPage() {
  return (
    <section className="pd-page" id="terms">
      <Letterhead />
      <div className="pd-terms-head">Terms and Conditions</div>
      <ol className="pd-terms-list">
        {ExpandProposalTerms.map(([heading, body], index) => (
          <li key={heading}>
            <b>
              {index + 1}. {heading}
            </b>{" "}
            {body}
          </li>
        ))}
      </ol>
    </section>
  );
}

function quantityLabel(quantity: number, unit: string): string {
  const figure = quantity.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${figure} ${unit}`;
}

function siteLines(proposal: PaperProposal): string[] {
  const { street, city } = proposal.site;
  return city ? [street, city] : [street];
}

function joinTitles(titles: string[]): string {
  if (titles.length <= 1) return titles.join("");
  return `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
}

function taxSentence(proposal: PaperProposal): string {
  if (proposal.tax.source === "none") return "No sales tax applies at this property.";
  if (proposal.taxCents === 0) return "Sales tax is not yet included.";
  return `This includes ${formatCentsExact(proposal.taxCents)} in Washington sales tax.`;
}

function taxLabel(tax: ProposalTax): string {
  if (tax.rate === undefined) return "Sales Tax";
  const percent = (tax.rate * 100).toLocaleString("en-US", { maximumFractionDigits: 4 });
  return `Sales Tax (${percent}%)`;
}
