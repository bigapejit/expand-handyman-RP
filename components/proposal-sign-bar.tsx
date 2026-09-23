"use client";

import { useEffect, useState } from "react";

import { ExpandBusiness, WashingtonNoticeToCustomer } from "@/lib/expand-business";
import {
  HelpBeforeNumber,
  paperDate,
  telHref,
  totalAndValidity,
  type PaperProposal,
} from "@/lib/proposal-paper";
import { SigningConsent, signingFaultMessage, signingFaults } from "@/lib/proposal-signing";

// The sign bar on a proposal's signing link: what the customer does on the
// paper, pinned to the bottom of the screen where a thumb already is. FRSG's
// roof-report/sign-bar.tsx with the owner's changes: the signer gives a name
// and no title, and "Read the Terms" sits in the closed bar beside Decline and
// again after the consent sentence. (Uploaded documents keep their own bar,
// components/sign-bar.tsx.)
//
// Closed it is one row: what the proposal costs and how long it stands, then
// Read the Terms, Decline and Sign. Open it rises into a sheet holding the
// whole of what a signature needs and nothing else: a name, pre-filled from
// the customer and editable; one tick that both consents to signing
// electronically and accepts the proposal and its Terms; and, at $1,000 or
// more in Washington, the **Notice to Customer** with a tick of its own.
// Decline is one press from either place and opens the sheet straight to the
// reason box.
//
// The sentences beside the ticks are the versioned constants the server
// records verbatim, and the checks run before Sign is let through are the same
// `signingFaults` the mutation refuses with, so the bar and the server can
// never disagree about what is missing. Once the customer has decided, the bar
// stops asking.

export type SignatureInput = {
  signerName: string;
  consentTicked: boolean;
  noticeTicked: boolean;
};

// Which of the bar's two forms is open, if either. Held by the page rather
// than by the bar, because the Sign here tag on the paper opens it too.
export type SignBarOpen = "sign" | "decline" | null;

export function ProposalSignBar({
  paper,
  noticeRequired,
  open,
  busy,
  error,
  onOpen,
  onReadTerms,
  onPendingName,
  onApprove,
  onDecline,
}: {
  paper: PaperProposal;
  noticeRequired: boolean;
  open: SignBarOpen;
  busy: boolean;
  // What the server said when it refused the act.
  error: string | null;
  onOpen: (which: SignBarOpen) => void;
  onReadTerms: () => void;
  // The name as it is being typed, for the pencil on the signature line.
  onPendingName: (name: string) => void;
  onApprove: (input: SignatureInput) => void;
  onDecline: (reason: string) => void;
}) {
  // Read off the state and never off the signature: a bar that asked "is it
  // signed?" by looking for one would offer to sign a proposal that already is.
  if (paper.state === "approved") {
    const signature = paper.signature;
    return (
      <div className="paper-bar">
        <div className="paper-bar-row">
          <span className="paper-bar-sum">
            {signature
              ? `Signed by ${signature.signerName} · ${paperDate(signature.signedAt)}`
              : "Signed"}
          </span>
        </div>
      </div>
    );
  }

  if (paper.state === "declined") {
    return (
      <div className="paper-bar">
        <div className="paper-bar-row">
          <span className="paper-bar-sum paper-bar-struck">
            {totalAndValidity(paper.totalCents, paper.sentAt)}
          </span>
          <span className="paper-grow" />
          {/* Plain words and a number, not a button: there is nothing left to
              press here, and Expand answers the phone. */}
          <span className="paper-bar-help">
            {HelpBeforeNumber}{" "}
            <a className="paper-tel" href={telHref(ExpandBusiness.phone)}>
              {ExpandBusiness.phone}
            </a>
          </span>
        </div>
      </div>
    );
  }

  if (open !== null) {
    return (
      <div className="paper-bar">
        <div className="paper-bar-sheet">
          <SignForm
            // A fresh form for each way in: opening Decline must not carry a
            // half-filled signature with it, nor the other way round.
            key={open}
            paper={paper}
            noticeRequired={noticeRequired}
            declining={open === "decline"}
            busy={busy}
            error={error}
            onClose={() => onOpen(null)}
            onDeclineInstead={() => onOpen("decline")}
            onReadTerms={onReadTerms}
            onPendingName={onPendingName}
            onApprove={onApprove}
            onDecline={onDecline}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="paper-bar">
      <div className="paper-bar-row">
        <span className="paper-bar-sum">{totalAndValidity(paper.totalCents, paper.sentAt)}</span>
        <span className="paper-grow" />
        <button type="button" className="paper-link" onClick={onReadTerms}>
          Read the Terms
        </button>
        <button
          type="button"
          className="paper-btn paper-btn-quiet"
          onClick={() => onOpen("decline")}
        >
          Decline
        </button>
        <button
          type="button"
          className="paper-btn paper-btn-primary"
          onClick={() => onOpen("sign")}
        >
          Sign Proposal {paper.number}
        </button>
      </div>
    </div>
  );
}

function SignForm({
  paper,
  noticeRequired,
  declining,
  busy,
  error,
  onClose,
  onDeclineInstead,
  onReadTerms,
  onPendingName,
  onApprove,
  onDecline,
}: {
  paper: PaperProposal;
  noticeRequired: boolean;
  declining: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onDeclineInstead: () => void;
  onReadTerms: () => void;
  onPendingName: (name: string) => void;
  onApprove: (input: SignatureInput) => void;
  onDecline: (reason: string) => void;
}) {
  const [signerName, setSignerName] = useState(paper.customerName);
  const [consentTicked, setConsentTicked] = useState(false);
  const [noticeTicked, setNoticeTicked] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [reason, setReason] = useState("");

  // The name stands on the line in pencil as it is typed, and the pre-filled
  // one from the moment the sheet opens. A sheet opened to Decline writes
  // nothing on the paper, and a sheet that closes takes the pencil with it.
  useEffect(() => {
    onPendingName(declining ? "" : signerName);
  }, [signerName, declining, onPendingName]);
  useEffect(() => () => onPendingName(""), [onPendingName]);

  const faults = signingFaults({ signerName, consentTicked, noticeRequired, noticeTicked });
  const shownFaults = attempted ? faults : [];

  return (
    <form
      noValidate
      className="paper-form"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (faults.length > 0 || busy) return;
        onApprove({ signerName, consentTicked, noticeTicked });
      }}
    >
      <div className="paper-form-head">
        <div className="paper-form-sum">{totalAndValidity(paper.totalCents, paper.sentAt)}</div>
        <button type="button" className="paper-link" onClick={onClose}>
          Keep reading
        </button>
      </div>

      {declining ? null : (
        <>
          <div className="paper-fields">
            <label htmlFor="sign-name">
              <span>Your name</span>
              <input
                id="sign-name"
                name="signerName"
                type="text"
                autoComplete="name"
                maxLength={200}
                value={signerName}
                onChange={(event) => setSignerName(event.target.value)}
                aria-invalid={shownFaults.includes("signer_name_required") || undefined}
              />
            </label>
          </div>

          <div>
            <label className="paper-tick">
              <input
                type="checkbox"
                name="consent"
                checked={consentTicked}
                onChange={(event) => setConsentTicked(event.target.checked)}
                aria-invalid={shownFaults.includes("consent_required") || undefined}
              />
              <span>{SigningConsent.wording(paper.number)}</span>
            </label>
            <button type="button" className="paper-link paper-tick-after" onClick={onReadTerms}>
              Read the Terms
            </button>
          </div>

          {noticeRequired ? (
            <div className="paper-notice">
              <div className="paper-notice-title">{WashingtonNoticeToCustomer.title}</div>
              <div className="paper-notice-text">{WashingtonNoticeToCustomer.text}</div>
              <label className="paper-tick">
                <input
                  type="checkbox"
                  name="notice"
                  checked={noticeTicked}
                  onChange={(event) => setNoticeTicked(event.target.checked)}
                  aria-invalid={shownFaults.includes("notice_required") || undefined}
                />
                <span>{WashingtonNoticeToCustomer.acknowledgement}</span>
              </label>
            </div>
          ) : null}
        </>
      )}

      {shownFaults.length > 0 ? (
        <p role="alert" className="paper-fault">
          {shownFaults.map(signingFaultMessage).join(" ")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="paper-fault">
          {error}
        </p>
      ) : null}

      {declining ? (
        <div className="paper-decline">
          <label>
            <span>Tell Expand Handyman why (optional)</span>
            <textarea
              name="reason"
              rows={2}
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="paper-actions">
            <span className="paper-grow" />
            <button
              type="button"
              className="paper-btn"
              disabled={busy}
              onClick={() => onDecline(reason)}
            >
              {busy ? "Declining…" : "Confirm decline"}
            </button>
          </div>
        </div>
      ) : (
        <div className="paper-actions">
          <button type="button" className="paper-link" onClick={onDeclineInstead}>
            Decline instead
          </button>
          <span className="paper-grow" />
          <button type="submit" className="paper-btn paper-btn-primary" disabled={busy}>
            {busy ? "Signing…" : `Sign Proposal ${paper.number}`}
          </button>
        </div>
      )}
    </form>
  );
}
