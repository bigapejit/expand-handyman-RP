"use client";

import { PaperScreen, scrollToCertificate, type PaperStrip } from "@/components/paper-screen";
import { PrototypeSwitcher, useVariant } from "@/components/prototype/prototype-switcher";
import { formatCentsExact } from "@/lib/money";
import { approvedBanner, paperDate } from "@/lib/proposal-paper";

import { ApprovedProposal, DepositDueCents, SignedAt } from "./fixtures";

// PROTOTYPE (#112): throwaway. The signing link the moment after the
// customer signs, when the deposit invoice has just gone out by email. Three
// answers to "what does the page offer now?", switched with `?variant=A|B|C`:
//
//   A  Nothing new: the banner says the deposit invoice is on its way by email.
//   B  A Pay-the-deposit button in the bar, beside "Signed by".
//   C  A Pay-the-deposit link in the banner under the top bar.
//
// Paying goes to the invoice-link prototype, in the same variant letter.

const Variants = [
  { key: "A", name: "Email only" },
  { key: "B", name: "Pay deposit in the bar" },
  { key: "C", name: "Pay deposit in the banner" },
] as const;
const VariantKeys = ["A", "B", "C"] as const;

export function ApprovedPrototype() {
  const variant = useVariant(VariantKeys);
  const deposit = formatCentsExact(DepositDueCents);
  const payHref = `/prototype/pay-now/link?variant=${variant}&reading=unpaid`;
  const signed = `Signed by Dana Whitfield · ${paperDate(SignedAt)}`;

  const strip: PaperStrip =
    variant === "A"
      ? {
          tone: "signed",
          body: (
            <>
              {approvedBanner(SignedAt)} Your deposit invoice, {deposit}, follows in a second
              email.{" "}
              <button type="button" onClick={scrollToCertificate}>
                See the certificate ›
              </button>
            </>
          ),
        }
      : variant === "B"
        ? {
            tone: "signed",
            body: (
              <>
                {approvedBanner(SignedAt)}{" "}
                <button type="button" onClick={scrollToCertificate}>
                  See the certificate ›
                </button>
              </>
            ),
          }
        : {
            tone: "signed",
            body: (
              <>
                You approved this proposal on {paperDate(SignedAt)}. A copy has been emailed to
                you, with the deposit invoice. <a href={payHref}>Pay the {deposit} deposit now ›</a>
              </>
            ),
          };

  const bar =
    variant === "B" ? (
      <div className="paper-bar">
        <div className="paper-bar-row">
          <span className="paper-bar-sum">{signed}</span>
          <span className="paper-grow" />
          <span className="paper-bar-help pn-bar-aside">or pay later, from the email</span>
          <a className="paper-btn paper-btn-primary" href={payHref}>
            Pay the {deposit} deposit
          </a>
        </div>
      </div>
    ) : (
      <div className="paper-bar">
        <div className="paper-bar-row">
          <span className="paper-bar-sum">{signed}</span>
        </div>
      </div>
    );

  return (
    <>
      <PaperScreen paper={ApprovedProposal} strip={strip} bar={bar} />
      <PrototypeSwitcher variants={Variants} current={variant} />
    </>
  );
}
