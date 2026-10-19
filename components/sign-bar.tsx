"use client";
// Adapted directly from FRSG's roof-report/sign-bar.tsx. The uploaded document
// replaces proposal pricing/number; the sheet structure and controls are retained.
import { useEffect, useState, type ReactNode } from "react";
import {
  CONSENT,
  signerName as validateName,
  signingDate,
} from "@/lib/signing";

export type SignBarOpen = "sign" | "decline" | null;
export type SignatureInput = { name: string; title: string; consent: boolean };
export function SignBar({
  document,
  open,
  busy,
  error,
  download,
  lockedInput,
  onOpen,
  onPendingName,
  onApprove,
  onDecline,
}: {
  document: {
    title: string;
    customerName: string;
    status: string;
    signerName?: string;
    signerTitle?: string;
    signedAt?: number;
  };
  open: SignBarOpen;
  busy: boolean;
  error: string;
  download: ReactNode;
  lockedInput?: SignatureInput;
  onOpen: (which: SignBarOpen) => void;
  onPendingName: (name: string) => void;
  onApprove: (input: SignatureInput) => void;
  onDecline: (reason: string) => void;
}) {
  if (document.status === "signed")
    return (
      <div className="paper-bar">
        <div className="paper-bar-row">
          <span className="paper-bar-sum">
            Signed by {document.signerName}
            {document.signerTitle ? `, ${document.signerTitle}` : ""} ·{" "}
            {signingDate(document.signedAt!)}
          </span>
          <span className="paper-grow" />
          {download}
        </div>
      </div>
    );
  if (document.status === "declined")
    return (
      <div className="paper-bar">
        <div className="paper-bar-row">
          <span className="paper-bar-sum paper-bar-struck">
            {document.title}
          </span>
          <span className="paper-grow" />
          <span className="paper-bar-help">
            Contact Expand Handyman if you need help.
          </span>
        </div>
      </div>
    );
  if (open !== null)
    return (
      <div className="paper-bar">
        <div className="paper-bar-sheet">
          <SignForm
            key={open}
            title={document.title}
            initialName={document.customerName}
            declining={open === "decline"}
            busy={busy}
            error={error}
            lockedInput={lockedInput}
            onClose={() => onOpen(null)}
            onDeclineInstead={() => onOpen("decline")}
            onPendingName={onPendingName}
            onApprove={onApprove}
            onDecline={onDecline}
          />
        </div>
      </div>
    );
  return (
    <div className="paper-bar">
      <div className="paper-bar-row">
        <span className="paper-bar-sum">{document.title}</span>
        <span className="paper-grow" />
        <button
          type="button"
          className="paper-btn paper-btn-quiet"
          disabled={busy}
          onClick={() => onOpen("decline")}
        >
          Decline
        </button>
        <button
          type="button"
          className="paper-btn paper-btn-primary"
          disabled={busy}
          onClick={() => onOpen("sign")}
        >
          Sign document
        </button>
      </div>
    </div>
  );
}

function SignForm({
  title,
  initialName,
  declining,
  busy,
  error,
  lockedInput,
  onClose,
  onDeclineInstead,
  onPendingName,
  onApprove,
  onDecline,
}: {
  title: string;
  initialName: string;
  declining: boolean;
  busy: boolean;
  error: string;
  lockedInput?: SignatureInput;
  onClose: () => void;
  onDeclineInstead: () => void;
  onPendingName: (name: string) => void;
  onApprove: (input: SignatureInput) => void;
  onDecline: (reason: string) => void;
}) {
  const [name, setName] = useState(lockedInput?.name ?? initialName);
  const [signerTitle, setSignerTitle] = useState(lockedInput?.title ?? "");
  const [consent, setConsent] = useState(lockedInput?.consent ?? false);
  const [attempted, setAttempted] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => {
    onPendingName(declining ? "" : name);
  }, [name, declining, onPendingName]);
  useEffect(() => () => onPendingName(""), [onPendingName]);
  const faults: string[] = [];
  try {
    validateName(name);
  } catch {
    faults.push("Enter your full name (2–100 characters).");
  }
  if (!consent) faults.push("Confirm your consent to sign electronically.");
  return (
    <form
      noValidate
      className="paper-form"
      onSubmit={(e) => {
        e.preventDefault();
        setAttempted(true);
        if (!busy && !declining && !faults.length)
          onApprove({ name, title: signerTitle, consent });
      }}
    >
      <div className="paper-form-head">
        <div className="paper-form-sum">{title}</div>
        <button
          type="button"
          className="paper-link"
          disabled={busy}
          onClick={onClose}
        >
          Keep reading
        </button>
      </div>
      {!declining && (
        <>
          <div className="paper-fields">
            <label htmlFor="sign-name">
              <span>Your name</span>
              <input
                id="sign-name"
                name="signerName"
                type="text"
                autoComplete="name"
                maxLength={100}
                value={name}
                disabled={busy || !!lockedInput}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={
                  (attempted && name.trim().length < 2) || undefined
                }
              />
            </label>
            <label htmlFor="sign-title">
              <span>Your title (optional)</span>
              <input
                id="sign-title"
                name="signerTitle"
                type="text"
                autoComplete="organization-title"
                maxLength={100}
                value={signerTitle}
                disabled={busy || !!lockedInput}
                onChange={(e) => setSignerTitle(e.target.value)}
              />
            </label>
          </div>
          <label className="paper-tick">
            <input
              type="checkbox"
              name="consent"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
              aria-invalid={(attempted && !consent) || undefined}
            />
            <span>{CONSENT}</span>
          </label>
        </>
      )}
      {!declining && attempted && faults.length > 0 && (
        <p role="alert" className="paper-fault">
          {faults.join(" ")}
        </p>
      )}
      {error && (
        <p role="alert" className="paper-fault">
          {error}
        </p>
      )}
      {declining ? (
        <div className="paper-decline">
          <label>
            <span>Tell Expand Handyman why (optional)</span>
            <textarea
              name="reason"
              rows={2}
              maxLength={1000}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
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
              Confirm decline
            </button>
          </div>
        </div>
      ) : (
        <div className="paper-actions">
          <button
            type="button"
            className="paper-link"
            disabled={busy}
            onClick={onDeclineInstead}
          >
            Decline instead
          </button>
          <span className="paper-grow" />
          <button
            type="submit"
            className="paper-btn paper-btn-primary"
            disabled={busy}
          >
            {busy ? "Signing…" : "Sign document"}
          </button>
        </div>
      )}
    </form>
  );
}
