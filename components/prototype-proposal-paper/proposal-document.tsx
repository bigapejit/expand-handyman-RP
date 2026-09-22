// PROTOTYPE (issue #22): throwaway. FRSG's components/roof-report/
// proposal-document.tsx copied with the changes settled on "Decide the proposal
// paper content for Expand" (#18): Expand wording, no sketch pages or markers,
// a Terms and Conditions page after the Grand Total, and only the electronic
// Certificate of Completion. Everything else is FRSG's, line for line.

import type { ReactNode } from "react";

import {
  ExpandBusiness,
  ExpandProposalTerms,
  Unknown,
  WashingtonNoticeToCustomer,
  letterheadContactLines,
} from "./expand-business";
import type { PaperProposal, PaperSignature, PaperSolution } from "./fixtures";

export type PendingSignature = { pendingName: string; onSignHere?: () => void };

const ValidityDays = 30;
const PaperTimeZoneLabel = "(UTC+00:00) Coordinated Universal Time";
const paperSerifStack = 'Tinos, "Times New Roman", Times, serif';

export function paperDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

function paperStamp(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  }).format(new Date(ms));
}

export function validUntil(sentAt: number): number {
  return sentAt + ValidityDays * 24 * 60 * 60 * 1000;
}

export function formatCentsExact(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function proposalCode(proposal: PaperProposal): string {
  return `${proposal.site.name}-P${proposal.number}`;
}

export function ProposalDocument({
  proposal,
  pending,
}: {
  proposal: PaperProposal;
  pending?: PendingSignature;
}) {
  const code = proposalCode(proposal);
  const signature = proposal.state === "approved" ? proposal.signature : undefined;
  const sheets = solutionPages(proposal.solutions);

  return (
    <article
      className="proposal-document"
      data-proposal={proposal.number}
      aria-label={
        signature ? `Signed copy of Proposal ${proposal.number}` : `Proposal ${proposal.number}`
      }
    >
      <ProposalPageRules number={proposal.number} code={code} />

      <section className="pd-page">
        <Letterhead />
        <CoverBlock proposal={proposal} code={code} />
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

      <TermsPage />

      {signature ? (
        <CertificateOfCompletion
          proposal={proposal}
          code={code}
          signature={signature}
          documentPages={1 + sheets.length + 1}
        />
      ) : null}
    </article>
  );
}

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

function CoverBlock({ proposal, code }: { proposal: PaperProposal; code: string }) {
  const rows: CoverRow[] = [
    { label: "Client", values: [proposal.customerName || Unknown] },
    { label: "Property", values: [proposal.site.street, proposal.site.city] },
    {
      label: "Estimator",
      values: [proposal.estimatorName],
      trailing: `Business: ${ExpandBusiness.phone}`,
      spaced: true,
    },
    { label: "Position", values: ["Estimator"], trailing: `E-mail: ${proposal.estimatorEmail}` },
    { label: "Company", values: [ExpandBusiness.company] },
    { label: "Business", values: [ExpandBusiness.serviceArea] },
    { label: "Type of Proposal", values: ["Handyman services"], spaced: true },
    { label: "Date Sent", values: [paperDate(proposal.sentAt)] },
    { label: "Valid Until", values: [paperDate(validUntil(proposal.sentAt))] },
    { label: "Proposal", values: [code], spaced: true },
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
        have any questions about this proposal, please contact {proposal.estimatorName} at{" "}
        {ExpandBusiness.phone} to discuss those questions.
      </p>
    </div>
  );
}

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
          name={signature ? signerDisplayName(signature) : null}
          date={signature ? paperDate(signature.signedAt) : null}
          pencil={signature || typed === "" ? null : (pending?.pendingName ?? null)}
          onSignHere={signature || typed !== "" ? undefined : pending?.onSignHere}
        />
        <SignatureLine
          label="Expand Handyman Representative"
          name={proposal.estimatorName}
          date={paperDate(proposal.sentAt)}
        />
      </div>
    </div>
  );
}

function signerDisplayName(signature: PaperSignature): string {
  const title = signature.signerTitle?.trim();
  return title ? `${signature.signerName}, ${title}` : signature.signerName;
}

function SignatureLine({
  label,
  rule,
  name,
  date,
  pencil = null,
  onSignHere,
}: {
  label: string;
  rule?: string;
  name: string | null;
  date: string | null;
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

function solutionPages(solutions: PaperSolution[]): PaperSolution[][] {
  const pages: PaperSolution[][] = [];
  let current: PaperSolution[] = [];
  let used = 0;
  for (const solution of solutions) {
    const lines = solutionLines(solution);
    if (current.length > 0 && used + lines > SolutionLinesPerPage) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(solution);
    used += lines;
  }
  pages.push(current);
  return pages;
}

const SolutionLinesPerPage = 48;

function solutionLines(solution: PaperSolution): number {
  const scope = scopeLines(solution.scopeOfWork).reduce(
    (total, line) => total + Math.ceil(line.length / 122),
    0,
  );
  return 3 + scope + 2 + Math.ceil(solution.lineItems.length * 1.3) + 7;
}

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

function GrandTotal({ proposal }: { proposal: PaperProposal }) {
  const depositCents = Math.round((proposal.totalCents * proposal.depositPercent) / 100);
  const finalPercent = 100 - proposal.depositPercent;
  const finalCents = proposal.totalCents - depositCents;
  const estimator = proposal.estimatorName;

  return (
    <div className="pd-grand">
      <table className="pd-grand-table">
        <tbody>
          {proposal.depositPercent > 0 ? (
            <tr>
              <th scope="row">{proposal.depositPercent}% due on signing</th>
              <td>{formatCentsExact(depositCents)}</td>
            </tr>
          ) : null}
          {finalPercent > 0 ? (
            <tr>
              <th scope="row">{finalPercent}% due on completion</th>
              <td>{formatCentsExact(finalCents)}</td>
            </tr>
          ) : null}
          <tr>
            <th scope="row">Subtotal</th>
            <td>{formatCentsExact(proposal.subtotalCents)}</td>
          </tr>
          <tr>
            <th scope="row">{taxLabel(proposal.taxRate)}</th>
            <td>{formatCentsExact(proposal.taxCents)}</td>
          </tr>
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

// NEW for Expand (#18): FRSG prints no Terms. Its own sheet, letterhead on
// top, after the Grand Total and before the certificate.
function TermsPage() {
  return (
    <section className="pd-page pd-terms" id="terms">
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

function CertificateOfCompletion({
  proposal,
  code,
  signature,
  documentPages,
}: {
  proposal: PaperProposal;
  code: string;
  signature: PaperSignature;
  documentPages: number;
}) {
  const estimator = proposal.estimatorName;
  const customer = proposal.customerName || Unknown;
  const signedFor = customer === signature.signerName ? null : customer;
  const notice = signature.notice;

  return (
    <>
      <section className="pd-page pd-certificate">
        <Band left="Certificate of Completion" right="Status: Completed" />
        <div className="pc-grid">
          <div>
            <div>Proposal Id: {code}</div>
            <div>
              Subject: Proposal {proposal.number} · {proposal.name}
            </div>
            <div>Property: {proposal.site.street}</div>
            <div>Client: {customer}</div>
            <div className="pc-gap">Document Pages: {documentPages}</div>
            <div>Certificate Pages: {notice ? 2 : 1}</div>
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
            <div className="pc-indent">{proposal.estimatorEmail}</div>
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
            {signature.signerTitle ? <div>{signature.signerTitle}</div> : null}
            {signedFor ? <div>{signedFor}</div> : null}
            <div>Security Level: Emailed private link</div>
          </div>
          <div>
            <SignatureBox label="Signed on Expand Handyman:" fingerprint={signature.fingerprint}>
              <div className="pc-sig">{signature.signerName}</div>
            </SignatureBox>
            <div className="pc-gap">Signature Adoption: Typed name</div>
            <div>Using IP Address: {signature.networkAddress ?? NotRecorded}</div>
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
              {signature.signerName}, {paperStamp(signature.signedAt)}
              {notice.version ? ` (wording ${notice.version})` : ""}.
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

function scopeLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\*\*/g, ""))
    .filter((line) => line.trim() !== "");
}

function joinTitles(titles: string[]): string {
  if (titles.length <= 1) return titles.join("");
  return `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
}

function taxSentence(proposal: PaperProposal): string {
  if (proposal.taxCents === 0) return "Sales tax is not yet included.";
  return `This includes ${formatCentsExact(proposal.taxCents)} in Washington sales tax.`;
}

function taxLabel(rate: number): string {
  const percent = (rate * 100).toLocaleString("en-US", { maximumFractionDigits: 4 });
  return `Sales Tax (${percent}%)`;
}
