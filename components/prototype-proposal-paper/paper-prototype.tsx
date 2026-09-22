"use client";

// PROTOTYPE (issue #22): throwaway. FRSG's paper screen (paper-screen.tsx) and
// sign bar (sign-bar.tsx) around the ported paper, in memory only: signing
// here flips the dummy proposal to Approved and nothing is saved.
//
// Variants are the paper's states, not competing designs: the question is
// whether the copy matches FRSG and which words change, so every state the
// customer or owner can see is one switch away.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ExpandBusiness,
  NoticeFloorCents,
  WashingtonNoticeToCustomer,
  signingConsentWording,
} from "./expand-business";
import { approvedSignature, proposalFor, type PaperProposal } from "./fixtures";
import { ProposalDocument, formatCentsExact, paperDate, validUntil } from "./proposal-document";

export const Variants = [
  { key: "sent", label: "Signing link: Sent, $1,000 or more" },
  { key: "small", label: "Signing link: Sent, under $1,000" },
  { key: "approved", label: "Signed copy with certificate" },
  { key: "preview", label: "Owner's preview of a Draft" },
] as const;

type Open = "sign" | "decline" | null;

export function PaperPrototype({ variant }: { variant: string }) {
  const [proposal, setProposal] = useState<PaperProposal>(() => proposalFor(variant));
  const [open, setOpen] = useState<Open>(null);
  const [pendingName, setPendingName] = useState("");
  const [declined, setDeclined] = useState<null | number>(null);
  const { scale, sheetsRef, naturalHeight } = usePaperFit();
  const scaled = scale < 1;

  useEffect(() => {
    setProposal(proposalFor(variant));
    setOpen(null);
    setPendingName("");
    setDeclined(null);
  }, [variant]);

  const onPendingName = useCallback((name: string) => setPendingName(name), []);
  const noticeRequired = proposal.totalCents >= NoticeFloorCents;
  const isPreview = proposal.state === "draft";
  const signing = !isPreview;

  const strip = isPreview
    ? { tone: "note", body: "Preview of a Draft" }
    : proposal.state === "approved" && proposal.signature
      ? {
          tone: "signed",
          body: `Signed by ${proposal.signature.signerName} on ${paperDate(proposal.signature.signedAt)}. A copy of the signed proposal is on its way to ${proposal.customerEmail}.`,
        }
      : declined
        ? {
            tone: "declined",
            body: `You declined Proposal ${proposal.number} on ${paperDate(declined)}. Expand Handyman has been told.`,
          }
        : null;

  return (
    <div
      className={`paper-screen${signing ? " paper-screen-signing" : ""}`}
      style={{ ["--paper-scale" as string]: String(scale) }}
    >
      <header className="paper-top">
        <div className="paper-top-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="paper-brand" src="/logo.svg" alt="Expand Handyman" />
          <span className="paper-title">
            Proposal {proposal.number} · {proposal.name}
          </span>
          {isPreview ? null : <DownloadButton proposal={proposal} />}
        </div>
        {strip ? <div className={`paper-strip paper-strip-${strip.tone}`}>{strip.body}</div> : null}
      </header>

      <div className="paper-sheets" ref={sheetsRef}>
        <div
          className={scaled ? "paper-sheets-scaled" : undefined}
          style={scaled && naturalHeight !== null ? { height: naturalHeight * scale } : undefined}
        >
          <ProposalDocument
            proposal={proposal}
            pending={
              proposal.state === "sent" && !declined
                ? { pendingName, onSignHere: () => setOpen("sign") }
                : undefined
            }
          />
        </div>
      </div>

      {signing ? (
        <SignBar
          proposal={proposal}
          declined={declined !== null}
          noticeRequired={noticeRequired}
          open={open}
          onOpen={setOpen}
          onPendingName={onPendingName}
          onApprove={(signerName, signerTitle, noticeTicked) => {
            setOpen(null);
            setProposal({
              ...proposal,
              state: "approved",
              signature: {
                ...approvedSignature(noticeRequired, signerName),
                signerTitle: signerTitle || undefined,
                signedAt: Date.now(),
                notice:
                  noticeRequired && noticeTicked
                    ? { wording: WashingtonNoticeToCustomer.text, version: WashingtonNoticeToCustomer.version }
                    : undefined,
                consentWording: signingConsentWording(proposal.number),
              },
            });
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onDecline={() => {
            setOpen(null);
            setDeclined(Date.now());
          }}
        />
      ) : null}

      <PrototypeSwitcher current={variant} />
    </div>
  );
}

// Stands in for FRSG's PaperDownload: the real one fetches the on-demand PDF
// (#19). Here it opens the browser's print dialogue, which uses the same
// print stylesheet the renderer would.
function DownloadButton({ proposal, primary = false }: { proposal: PaperProposal; primary?: boolean }) {
  return (
    <button
      type="button"
      className={primary ? "paper-btn paper-btn-primary" : "paper-btn"}
      onClick={() => window.print()}
    >
      {proposal.state === "approved" ? "Download signed copy" : "Download PDF"}
    </button>
  );
}

function totalAndValidity(proposal: PaperProposal): string {
  return `${formatCentsExact(proposal.totalCents)} · valid until ${paperDate(validUntil(proposal.sentAt))}`;
}

function scrollToTerms() {
  document.getElementById("terms")?.scrollIntoView({ behavior: "smooth" });
}

function ReadTheTerms() {
  return (
    <button type="button" className="paper-link" onClick={scrollToTerms}>
      Read the Terms
    </button>
  );
}

function SignBar({
  proposal,
  declined,
  noticeRequired,
  open,
  onOpen,
  onPendingName,
  onApprove,
  onDecline,
}: {
  proposal: PaperProposal;
  declined: boolean;
  noticeRequired: boolean;
  open: Open;
  onOpen: (open: Open) => void;
  onPendingName: (name: string) => void;
  onApprove: (signerName: string, signerTitle: string, noticeTicked: boolean) => void;
  onDecline: () => void;
}) {
  if (proposal.state === "approved") {
    const signature = proposal.signature;
    return (
      <div className="paper-bar">
        <div className="paper-bar-row">
          <span className="paper-bar-sum">
            {signature
              ? `Signed by ${signature.signerName} · ${paperDate(signature.signedAt)}`
              : "Signed"}
          </span>
          <span className="paper-grow" />
          <DownloadButton proposal={proposal} primary />
        </div>
      </div>
    );
  }

  if (declined) {
    return (
      <div className="paper-bar">
        <div className="paper-bar-row">
          <span className="paper-bar-sum paper-bar-struck">{totalAndValidity(proposal)}</span>
          <span className="paper-grow" />
          <span className="paper-bar-help">
            Have any questions or need help? Call Expand Handyman at{" "}
            <a className="paper-tel" href={`tel:${ExpandBusiness.phone.replace(/[^\d+]/g, "")}`}>
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
            key={open}
            proposal={proposal}
            noticeRequired={noticeRequired}
            declining={open === "decline"}
            onClose={() => onOpen(null)}
            onDeclineInstead={() => onOpen("decline")}
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
        <span className="paper-bar-sum">{totalAndValidity(proposal)}</span>
        <span className="paper-grow" />
        <ReadTheTerms />
        <button type="button" className="paper-btn paper-btn-quiet" onClick={() => onOpen("decline")}>
          Decline
        </button>
        <button type="button" className="paper-btn paper-btn-primary" onClick={() => onOpen("sign")}>
          Sign Proposal {proposal.number}
        </button>
      </div>
    </div>
  );
}

function SignForm({
  proposal,
  noticeRequired,
  declining,
  onClose,
  onDeclineInstead,
  onPendingName,
  onApprove,
  onDecline,
}: {
  proposal: PaperProposal;
  noticeRequired: boolean;
  declining: boolean;
  onClose: () => void;
  onDeclineInstead: () => void;
  onPendingName: (name: string) => void;
  onApprove: (signerName: string, signerTitle: string, noticeTicked: boolean) => void;
  onDecline: () => void;
}) {
  const [signerName, setSignerName] = useState(proposal.customerName);
  const [signerTitle, setSignerTitle] = useState("");
  const [consentTicked, setConsentTicked] = useState(false);
  const [noticeTicked, setNoticeTicked] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    onPendingName(declining ? "" : signerName);
  }, [signerName, declining, onPendingName]);
  useEffect(() => () => onPendingName(""), [onPendingName]);

  const faults: string[] = [];
  if (!signerName.trim()) faults.push("Type your name to sign.");
  if (!consentTicked) faults.push("Tick the box to agree to sign electronically.");
  if (noticeRequired && !noticeTicked) faults.push("Tick the box to confirm you received the Notice to Customer.");
  const shown = attempted ? faults : [];

  return (
    <form
      noValidate
      className="paper-form"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (faults.length > 0) return;
        onApprove(signerName, signerTitle, noticeTicked);
      }}
    >
      <div className="paper-form-head">
        <div className="paper-form-sum">{totalAndValidity(proposal)}</div>
        <button type="button" className="paper-link" onClick={onClose}>
          Keep reading
        </button>
      </div>

      {declining ? null : (
        <>
          <div className="paper-fields">
            <label>
              <span>Your name</span>
              <input
                type="text"
                autoComplete="name"
                value={signerName}
                onChange={(event) => setSignerName(event.target.value)}
                aria-invalid={(attempted && !signerName.trim()) || undefined}
              />
            </label>
            <label>
              <span>Your title (optional)</span>
              <input
                type="text"
                autoComplete="organization-title"
                value={signerTitle}
                onChange={(event) => setSignerTitle(event.target.value)}
              />
            </label>
          </div>

          <label className="paper-tick">
            <input
              type="checkbox"
              checked={consentTicked}
              onChange={(event) => setConsentTicked(event.target.checked)}
            />
            <span>
              {signingConsentWording(proposal.number)} <ReadTheTerms />
            </span>
          </label>

          {noticeRequired ? (
            <div className="paper-notice">
              <div className="paper-notice-title">{WashingtonNoticeToCustomer.title}</div>
              <div className="paper-notice-text">{WashingtonNoticeToCustomer.text}</div>
              <label className="paper-tick">
                <input
                  type="checkbox"
                  checked={noticeTicked}
                  onChange={(event) => setNoticeTicked(event.target.checked)}
                />
                <span>{WashingtonNoticeToCustomer.acknowledgement}</span>
              </label>
            </div>
          ) : null}
        </>
      )}

      {shown.length > 0 ? (
        <p role="alert" className="paper-fault">
          {shown.join(" ")}
        </p>
      ) : null}

      {declining ? (
        <div className="paper-decline">
          <label>
            <span>Tell Expand Handyman why (optional)</span>
            <textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="paper-actions">
            <span className="paper-grow" />
            <button type="button" className="paper-btn" onClick={onDecline}>
              Confirm decline
            </button>
          </div>
        </div>
      ) : (
        <div className="paper-actions">
          <button type="button" className="paper-link" onClick={onDeclineInstead}>
            Decline instead
          </button>
          <span className="paper-grow" />
          <button type="submit" className="paper-btn paper-btn-primary">
            Sign Proposal {proposal.number}
          </button>
        </div>
      )}
    </form>
  );
}

// FRSG's usePaperFit, verbatim.
function usePaperFit() {
  const [scale, setScale] = useState(1);
  const [naturalHeight, setNaturalHeight] = useState<number | null>(null);
  const sheetsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sheets = sheetsRef.current;
    if (!sheets) return;
    const measure = () => setScale(Math.min(1, Math.max(0.1, (sheets.clientWidth - 20) / (8.5 * 96))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sheets);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = sheetsRef.current?.querySelector<HTMLElement>(".proposal-document");
    if (!node) return;
    const observer = new ResizeObserver(() => setNaturalHeight(node.offsetHeight));
    observer.observe(node);
    setNaturalHeight(node.offsetHeight);
    return () => observer.disconnect();
  }, []);

  return { scale, sheetsRef, naturalHeight };
}

function PrototypeSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const index = Math.max(
    0,
    Variants.findIndex((variant) => variant.key === current),
  );
  const go = useCallback(
    (step: number) => {
      const next = Variants[(index + step + Variants.length) % Variants.length];
      router.replace(`?variant=${next.key}`, { scroll: false });
    },
    [index, router],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (process.env.NODE_ENV === "production") return null;
  const variant = Variants[index];
  return (
    <div className="proto-switcher">
      <button type="button" onClick={() => go(-1)} aria-label="Previous variant">
        ←
      </button>
      <span>
        {index + 1}/{Variants.length} · {variant.label}
      </span>
      <button type="button" onClick={() => go(1)} aria-label="Next variant">
        →
      </button>
    </div>
  );
}
