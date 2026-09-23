import type { ReactNode } from "react";

import {
  ExpandBusiness,
  WashingtonNoticeToCustomer,
  letterheadContactLines,
} from "@/lib/expand-business";
import { formatCentsExact } from "@/lib/money";
import { paperSerifStack } from "@/lib/paper-fonts";
import {
  PaperTimeZoneLabel,
  ValidityDays,
  certificatePages,
  documentPages,
  paperDate,
  paperStamp,
  scopeLines,
  solutionSheets,
  validUntil,
  type PaperProposal,
  type PaperSignature,
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
// Total closing the last, then the Terms, and on an approved proposal the
// Certificate of Completion. The only money on the paper is the Grand Total
// block: a solution carries no price of its own.
//
// Every moment on the paper is read in UTC (lib/proposal-paper.ts), so the day
// beside a signature is the same day wherever the paper is read.

// The customer's line while they are signing: the name as it is being typed,
// in pencil, and the Sign here tag that opens the sign bar.
export type PendingSignature = { pendingName: string; onSignHere?: () => void };

// Who foots the printed sheets. The page does it for a browser's print, with
// CSS page-margin boxes; the PDF renderer draws its own footer and opens the
// paper flagged so the page leaves its off (lib/pdf-copy.ts,
// RendererFooterParam), or a renderer that learns margin boxes would print two.
export type PaperFooter = "page" | "renderer";

export function ProposalPaper({
  proposal,
  pending,
  footer = "page",
}: {
  proposal: PaperProposal;
  pending?: PendingSignature;
  footer?: PaperFooter;
}) {
  const sheets = solutionSheets(proposal.solutions);
  const signature = proposal.state === "approved" ? proposal.signature : undefined;

  return (
    <article
      className="proposal-document"
      data-proposal={proposal.number}
      aria-label={
        signature ? `Signed copy of Proposal ${proposal.number}` : `Proposal ${proposal.number}`
      }
    >
      {footer === "page" ? (
        <ProposalPageRules number={proposal.number} code={proposal.code} />
      ) : null}

      <section className="pd-page">
        <Letterhead />
        <CoverBlock proposal={proposal} />
        <Letter proposal={proposal} />
        <AgreeAndSign proposal={proposal} signature={signature} pending={pending} />
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

      <TermsPage terms={proposal.terms} />

      {signature ? <CertificateOfCompletion proposal={proposal} signature={signature} /> : null}
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
// the sent date. The customer's line is blank until they sign: while they
// type it carries their name in pencil, and once approved their name in
// script with the day they signed.
function AgreeAndSign({
  proposal,
  signature,
  pending,
}: {
  proposal: PaperProposal;
  signature: PaperSignature | undefined;
  pending: PendingSignature | undefined;
}) {
  const typed = pending?.pendingName.trim() ?? "";
  return (
    <div className="pd-agree">
      <p>
        I/we agree to the terms and conditions of this proposal, including the Terms and
        Conditions page.
      </p>
      <div className="pd-signatures">
        <SignatureLine
          label="Owner/Authorized Signature"
          rule="pd-customer-rule"
          name={signature?.signerName ?? null}
          date={signature ? paperDate(signature.signedAt) : null}
          pencil={signature || typed === "" ? null : typed}
          onSignHere={signature || typed !== "" ? undefined : pending?.onSignHere}
        />
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
  rule,
  name = null,
  date = null,
  pencil = null,
  onSignHere,
}: {
  label: string;
  rule?: string;
  name?: string | null;
  date?: string | null;
  pencil?: string | null;
  onSignHere?: () => void;
}) {
  return (
    <div className="pd-signature">
      <div className="pd-signature-row">
        <span className={rule ? `pd-signature-rule ${rule}` : "pd-signature-rule"}>
          {name ? (
            <span className="pd-script">{name}</span>
          ) : pencil ? (
            <span className="pd-script pd-pencil">{pencil}</span>
          ) : null}
          {onSignHere ? (
            <button type="button" className="pd-sign-here" onClick={onSignHere}>
              Sign here
            </button>
          ) : null}
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
// scrolls to. The wording is the proposal's own: frozen at Send, so a later
// change to the Terms never rewrites what a customer was offered.
function TermsPage({ terms }: { terms: PaperProposal["terms"] }) {
  return (
    <section className="pd-page" id="terms">
      <Letterhead />
      <div className="pd-terms-head">Terms and Conditions</div>
      <ol className="pd-terms-list">
        {terms.map(({ heading, body }, index) => (
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

// The record of how the proposal was signed, closing the signed copy: FRSG's
// electronic Certificate of Completion with Expand's names in it. It prints in
// UTC and says so, carries the fingerprint of the offer as sealed at Approve,
// and has a second sheet with Washington's Notice to Customer where the
// customer acknowledged it. No network address is kept (ADR 0001), so there is
// no line for one; the browser line is clamped so a phone's long user agent
// never pushes the first sheet onto a second.
function CertificateOfCompletion({
  proposal,
  signature,
}: {
  proposal: PaperProposal;
  signature: PaperSignature;
}) {
  const estimator = proposal.estimator.name;
  const customer = proposal.customerName;
  const signedFor = customer === signature.signerName ? null : customer;
  const notice = signature.notice;

  return (
    <>
      <section className="pd-page pd-certificate">
        <Band left="Certificate of Completion" right="Status: Completed" />
        <div className="pc-grid">
          <div>
            <div>Proposal Id: {proposal.code}</div>
            <div>
              Subject: Proposal {proposal.number} · {proposal.name}
            </div>
            <div>Property: {proposal.site.street}</div>
            <div>Client: {customer}</div>
            <div className="pc-gap">Document Pages: {documentPages(proposal.solutions)}</div>
            <div>Certificate Pages: {certificatePages(notice !== undefined)}</div>
            <div>Time Zone: {PaperTimeZoneLabel}</div>
          </div>
          <div>
            <div className="pc-gap-head">Signatures: 1</div>
            <div>Initials: 0</div>
            <div>Notice to Customer: {noticeStanding(signature)}</div>
          </div>
          <div>
            <div>Proposal Originator:</div>
            <div>{estimator}</div>
            <div>{ExpandBusiness.letterheadName}</div>
            {letterheadContactLines().map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>

        <Band left="Record Tracking" />
        <div className="pc-grid">
          <div>
            <div>Status: Original</div>
            <div className="pc-indent">{paperStamp(proposal.sentAt)}</div>
          </div>
          <div>
            <div>Holder: {estimator}</div>
            <div className="pc-indent">{proposal.estimator.email}</div>
          </div>
          <div>
            <div>Location: {ExpandBusiness.letterheadName}</div>
            <div className="pc-gap">Sent to:</div>
            <div className="pc-indent">{customer}</div>
          </div>
        </div>

        <Band left="Signer Events" middle="Signature" right="Timestamp" />
        <div className="pc-grid">
          <div>
            <div>{signature.signerName}</div>
            {signedFor ? <div>{signedFor}</div> : null}
            <div>Security Level: Emailed private link</div>
          </div>
          <div>
            <SignatureBox label="Signed on Expand Handyman:" fingerprint={signature.fingerprint}>
              <div className="pc-sig">{signature.signerName}</div>
            </SignatureBox>
            <div className="pc-gap">Signature Adoption: Typed name</div>
            <div className="pc-browser">Browser: {signature.userAgent ?? NotRecorded}</div>
          </div>
          <div>
            <div>Sent: {paperStamp(proposal.sentAt)}</div>
            <div>Viewed: {openedStamp(signature.firstOpenedAt)}</div>
            <div>Signed: {paperStamp(signature.signedAt)}</div>
          </div>
        </div>
        <div className="pc-disclosure">
          <b>Electronic Record and Signature Disclosure:</b>
          <div className="pc-indent">
            {signature.consentWording} (wording {signature.consentWordingVersion})
          </div>
        </div>

        <Band left="Expand Handyman Representative Events" middle="Signature" right="Timestamp" />
        <div className="pc-grid">
          <div>
            <div>{estimator}</div>
            <div>{ExpandBusiness.letterheadName}</div>
          </div>
          <div>
            <div className="pc-sigbox">
              <div className="pc-sigbox-label">Sent by Expand Handyman:</div>
              <div className="pc-sig">{estimator}</div>
            </div>
          </div>
          <div>
            <div>Sent: {paperStamp(proposal.sentAt)}</div>
          </div>
        </div>

        <Band left="Proposal Summary Events" middle="Status" right="Timestamps" />
        <div className="pc-grid">
          <div>
            <div>Proposal Sent</div>
            <div>Signing Link Opened</div>
            <div>Signing Complete</div>
            <div>Completed</div>
          </div>
          <div>
            <div>Hashed/Encrypted</div>
            <div>Security Checked</div>
            <div>Security Checked</div>
            <div>Security Checked</div>
          </div>
          <div>
            <div>{paperStamp(proposal.sentAt)}</div>
            <div>{openedStamp(signature.firstOpenedAt)}</div>
            <div>{paperStamp(signature.signedAt)}</div>
            <div>{paperStamp(signature.signedAt)}</div>
          </div>
        </div>

        <Band left="Sealed Copy" middle="Fingerprint (SHA-256)" />
        <div className="pc-grid">
          <div>Proposal as accepted</div>
          <div className="pc-mono pc-span2">{signature.fingerprint}</div>
        </div>
      </section>

      {notice ? (
        <section className="pd-page pd-certificate">
          <Band
            left="Certificate of Completion"
            right={`${WashingtonNoticeToCustomer.title} (Washington)`}
          />
          <div className="pc-notice">
            <p className="pc-prose">{notice.wording}</p>
            <p>
              {WashingtonNoticeToCustomer.acknowledgement} — acknowledged by{" "}
              {signature.signerName}, {paperStamp(signature.signedAt)} (wording {notice.version}).
            </p>
          </div>
        </section>
      ) : null}
    </>
  );
}

function SignatureBox({
  label,
  fingerprint,
  children,
}: {
  label: string;
  fingerprint: string;
  children: ReactNode;
}) {
  return (
    <div className="pc-sigbox">
      <div className="pc-sigbox-label">{label}</div>
      {children}
      <div className="pc-sigbox-id">{`${fingerprint.slice(0, 16).toUpperCase()}…`}</div>
    </div>
  );
}

function Band({ left, middle = "", right = "" }: { left: string; middle?: string; right?: string }) {
  return (
    <div className="pc-band">
      <span>{left}</span>
      <span>{middle}</span>
      <span>{right}</span>
    </div>
  );
}

const NotRecorded = "Not recorded";

function openedStamp(firstOpenedAt: number | undefined): string {
  return firstOpenedAt === undefined ? NotRecorded : paperStamp(firstOpenedAt);
}

function noticeStanding(signature: PaperSignature): string {
  if (!signature.noticeShown) return "Not required";
  return signature.notice ? "Shown and acknowledged" : "Shown; not acknowledged";
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
