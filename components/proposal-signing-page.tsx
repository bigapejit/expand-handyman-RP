"use client";

import "@/app/paper-print.css";
import "@/app/proposal-paper.css";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { LinkNotLive } from "@/components/link-not-live";
import {
  PaperLoading,
  PaperScreen,
  scrollToCertificate,
  scrollToSignatureLine,
  scrollToTerms,
  type PaperStrip,
} from "@/components/paper-screen";
import {
  ProposalSignBar,
  type SignBarOpen,
  type SignatureInput,
} from "@/components/proposal-sign-bar";
import { useViewHeartbeat } from "@/components/view-heartbeat";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { WashingtonNoticeToCustomer } from "@/lib/expand-business";
import { approvedBanner, declinedBanner, type PaperProposal } from "@/lib/proposal-paper";
import { SigningConsent } from "@/lib/proposal-signing";
import { errorMessage } from "@/lib/utils";

// The customer reading a sent proposal through its signing link: the paper
// exactly as Send froze it, with the sign bar over it (FRSG's
// roof-report/signing-route.tsx). The name typed into the bar lands on the
// customer's line in pencil as it is typed, and stands there in script with
// the date once they approve.
//
// Every open is logged once the paper has arrived, as a view or, when the
// owner is signed in, as an owner preview (ADR 0001), and the heartbeat keeps
// it counting while the tab is visible. The page follows the proposal live: an
// answer given here stamps the paper where it stands, and a link withdrawn or
// replaced while the page is open turns into "This link is no longer live".
// After an answer the link stays readable but can't act again.
export function ProposalSigningPage({ token }: { token: string }) {
  const page = useQuery(api.signingLinks.page, { token });
  const opened = useMutation(api.signingLinks.opened);
  const seen = useMutation(api.signingLinks.seen);
  const approve = useAction(api.proposals.approve);
  const decline = useMutation(api.proposals.declineFromLink);
  const view = useRef<Id<"proposalViews"> | null>(null);
  const logged = useRef(false);
  const arrived = page !== undefined && page !== null;

  // The bar: which of its two forms is open, the name being typed into it,
  // what it is waiting on, and what the server said if it refused.
  const [open, setOpen] = useState<SignBarOpen>(null);
  const [pendingName, setPendingName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!arrived || logged.current) return;
    logged.current = true;
    void opened({ token, userAgent: navigator.userAgent })
      .then((id) => {
        view.current = id;
      })
      .catch(() => {});
  }, [arrived, opened, token]);
  useViewHeartbeat(view, token, seen, "proposal");

  if (page === undefined) return <PaperLoading />;
  if (page === null) return <LinkNotLive what="proposal" />;
  const { paper, noticeRequired } = page;

  // One of the two acts, run against the server. The form closes only when the
  // server has committed; a refusal stays on the form, in its words. What the
  // page shows afterwards is not decided here: the query re-reads the
  // proposal, and the paper, the banner and the bar all follow it.
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      setOpen(null);
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <PaperScreen
      paper={paper}
      strip={decisionStrip(paper)}
      // The PDF copy, while this link opens the paper: the offer, or the
      // signed copy once approved. A declined proposal has none. The owner
      // previewing through the link gets the same button.
      download={{ token }}
      pending={
        paper.state === "sent"
          ? {
              pendingName,
              onSignHere: () => {
                setError(null);
                setOpen("sign");
                scrollToSignatureLine();
              },
            }
          : undefined
      }
      bar={
        <ProposalSignBar
          paper={paper}
          noticeRequired={noticeRequired}
          open={open}
          busy={busy}
          error={error}
          onOpen={(which) => {
            setError(null);
            setOpen(which);
            // However the form was opened, the line the name is about to land
            // on comes with it.
            if (which === "sign") scrollToSignatureLine();
          }}
          // On a phone the open sheet covers most of the paper, so it closes
          // to let the Terms be read.
          onReadTerms={() => {
            setOpen(null);
            scrollToTerms();
          }}
          onPendingName={setPendingName}
          onApprove={(input: SignatureInput) => {
            void act(() =>
              approve({
                token,
                signerName: input.signerName,
                consentTicked: input.consentTicked,
                noticeTicked: input.noticeTicked,
                // The versions of the sentences this page showed, so a
                // signature is never recorded under wording its signer did
                // not read.
                consentWordingVersion: SigningConsent.version,
                noticeWordingVersion: WashingtonNoticeToCustomer.version,
                userAgent: navigator.userAgent,
              }),
            ).then((done) => {
              // The signature is on the line now; bring it back to where the
              // customer was looking when they signed.
              if (done) scrollToSignatureLine();
            });
          }}
          onDecline={(reason: string) => {
            void act(() => decline({ token, ...(reason.trim() ? { reason } : {}) })).then(
              (done) => {
                // The answer to a Decline is at the top of the page.
                if (done) window.scrollTo({ top: 0, behavior: "smooth" });
              },
            );
          }}
        />
      }
    />
  );
}

// The banner once the customer has answered, in the words settled on #17.
function decisionStrip(paper: PaperProposal): PaperStrip | undefined {
  if (paper.state === "approved" && paper.signature)
    return {
      tone: "signed",
      body: (
        <>
          {approvedBanner(paper.signature.signedAt)}{" "}
          <button type="button" onClick={scrollToCertificate}>
            See the certificate ›
          </button>
        </>
      ),
    };
  if (paper.state === "declined" && paper.declinedAt !== undefined)
    return { tone: "declined", body: declinedBanner(paper.declinedAt) };
  return undefined;
}
