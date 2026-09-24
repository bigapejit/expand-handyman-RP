"use client";

import type { FunctionReturnType } from "convex/server";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";

import { api } from "@/convex/_generated/api";
import { ExpandBusiness } from "@/lib/expand-business";
import { formatCentsExact } from "@/lib/money";
import {
  CardLimitNote,
  customerOnItsWay,
  customerReturned,
  NoFeeNote,
  StripeRangeNote,
  zelleQrUrl,
  type PayMethod,
} from "@/lib/pay-now";
import { errorMessage } from "@/lib/utils";

// **Pay now** (CONTEXT.md) on an invoice link: the pay bar pinned under the
// paper, in the sign bar's own classes, and the **Pay sheet** it rises into.
// Sketch D of the prototype/pay-now branch, fed from the link's page query.
//
// Closed it is one row: what is due, and one black Pay button. Open it lists
// the four ways at the one price, or Zelle and check alone for an Amount Due
// Stripe will not charge. Bank and card go to Stripe's own page for
// the full Amount Due, so no bank or card details are ever typed here; Zelle
// and check turn the sheet into the steps to follow, since no link can fill
// in a customer's banking app for them. While a bank payment is on its way
// the bar keeps its place with no button, so nobody pays twice; after a
// **Returned payment** the unpaid bar comes back with one sentence above it.
// A paid, void or $0 invoice has no bar at all: the page asks only for money
// that is owed.

export type InvoiceLinkPage = NonNullable<FunctionReturnType<typeof api.invoiceLinks.page>>;

// Whether the link has a bar at all: while something is owed and may be
// paid, or while a bank payment for it is on its way. Not whether Stripe is
// offered: an Amount Due Stripe will not charge is still paid by Zelle or
// check.
export function payBarShows(page: InvoiceLinkPage): boolean {
  return page.payable || page.stripe?.kind === "on_its_way";
}

// Which way's steps the open sheet shows in place of the list.
type Step = "zelle" | "check" | null;

export function PayBar({
  token,
  page,
  openOnArrival,
}: {
  token: string;
  page: InvoiceLinkPage;
  // The deposit button after signing sends the customer here with the sheet
  // already open (`?pay=1`).
  openOnArrival: boolean;
}) {
  const [open, setOpen] = useState(openOnArrival);
  const { stripe, amountDueCents } = page;
  const amount = formatCentsExact(amountDueCents);

  if (stripe?.kind === "on_its_way") {
    const said = customerOnItsWay(stripe);
    return (
      <div className="paper-bar">
        <p className="paper-bar-note">{said.help}</p>
        <div className="paper-bar-row">
          <span className="paper-bar-sum">
            <strong>{said.head}</strong> · {said.row}
          </span>
        </div>
      </div>
    );
  }

  // The link offers no way to pay once nothing is owed: paid, void, or $0.
  if (!payBarShows(page)) return null;

  if (open)
    return (
      <div className="paper-bar">
        <div className="paper-bar-sheet">
          <PaySheet token={token} page={page} onClose={() => setOpen(false)} />
        </div>
      </div>
    );

  return (
    <div className="paper-bar">
      {stripe?.kind === "returned" ? (
        <p className="paper-bar-note">{customerReturned(stripe)}</p>
      ) : null}
      <div className="paper-bar-row">
        <span className="paper-bar-sum">
          <strong>{amount}</strong> · due on receipt
        </span>
        <span className="paper-grow" />
        <button
          type="button"
          className="paper-btn paper-btn-primary"
          onClick={() => setOpen(true)}
        >
          Pay {amount}
        </button>
      </div>
    </div>
  );
}

function PaySheet({
  token,
  page,
  onClose,
}: {
  token: string;
  page: InvoiceLinkPage;
  onClose: () => void;
}) {
  const mint = useAction(api.stripePayments.mintCheckoutSession);
  const [step, setStep] = useState<Step>(null);
  // The way on its way to Stripe, and what the server said if it refused.
  const [opening, setOpening] = useState<PayMethod | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const { ways, amountDueCents, invoiceNumber } = page;
  const amount = formatCentsExact(amountDueCents);
  const bank = ways.includes("bank");
  const card = ways.includes("card");

  // A customer who backs out of Stripe's page with the browser's Back button
  // may get this page from the browser's memory, still opening Stripe; the
  // rows come back to life for them.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setOpening(null);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  // Stripe's own page for the full Amount Due. The rows stay pressed until
  // the browser has left, so one press is one session.
  const pay = async (method: PayMethod) => {
    setOpening(method);
    setFault(null);
    try {
      const { url } = await mint({ token, method });
      window.location.assign(url);
    } catch (error) {
      setFault(errorMessage(error));
      setOpening(null);
    }
  };

  return (
    <div className="paper-form">
      <div className="paper-form-head">
        <div className="paper-form-sum">
          {step === "zelle" ? (
            <>
              Pay <strong>{amount}</strong> by Zelle®
            </>
          ) : step === "check" ? (
            <>
              Pay <strong>{amount}</strong> by check
            </>
          ) : (
            <>
              <strong>{amount}</strong> · due on receipt
            </>
          )}
        </div>
        <button
          type="button"
          className="paper-link"
          onClick={step ? () => setStep(null) : onClose}
        >
          {step ? "Back" : "Close"}
        </button>
      </div>

      {step === "zelle" ? (
        <ZelleSteps tag={page.zelleTag} amount={amount} invoiceNumber={invoiceNumber} />
      ) : step === "check" ? (
        <CheckSteps
          mailingAddress={page.mailingAddress}
          amount={amount}
          invoiceNumber={invoiceNumber}
        />
      ) : (
        <>
          <div className="paper-pay-choices">
            {bank ? (
              <Choice
                name="Pay by bank"
                note={
                  opening === "bank"
                    ? "Opening Stripe…"
                    : "From your checking account, through Stripe."
                }
                amount={amount}
                disabled={opening !== null}
                onPress={() => void pay("bank")}
              />
            ) : null}
            {card ? (
              <Choice
                name="Pay by card"
                note={opening === "card" ? "Opening Stripe…" : "Credit or debit, on Stripe’s page."}
                amount={amount}
                disabled={opening !== null}
                onPress={() => void pay("card")}
              />
            ) : null}
            <Choice
              name="Pay by Zelle®"
              note="From your banking app, to our Zelle® tag."
              amount={amount}
              disabled={opening !== null}
              onPress={() => setStep("zelle")}
            />
            <Choice
              name="Pay by check"
              note={`Payable to ${ExpandBusiness.letterheadName}.`}
              amount={amount}
              disabled={opening !== null}
              onPress={() => setStep("check")}
            />
          </div>
          {fault ? (
            <p role="alert" className="paper-fault">
              {fault}
            </p>
          ) : null}
          <p className="paper-pay-text">
            {card ? NoFeeNote : `${NoFeeNote} ${bank ? CardLimitNote : StripeRangeNote}`}
          </p>
        </>
      )}
    </div>
  );
}

// One way to pay, as a row of the sheet: the way, a line about it, and the
// amount, which is the Amount Due whichever way is picked.
function Choice({
  name,
  note,
  amount,
  disabled,
  onPress,
}: {
  name: string;
  note: string;
  amount: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <button type="button" className="paper-pay-choice" disabled={disabled} onClick={onPress}>
      <span className="paper-pay-choice-name">{name}</span>
      <span className="paper-pay-choice-note" aria-live="polite">
        {note}
      </span>
      <span className="paper-pay-choice-amount">{amount}</span>
    </button>
  );
}

// Pay by Zelle®: the customer's own bank does the paying, so the sheet says
// exactly what to type there. Zelle's name is plain text with its mark, never
// its logo.
function ZelleSteps({
  tag,
  amount,
  invoiceNumber,
}: {
  tag: string;
  amount: string;
  invoiceNumber: string;
}) {
  const [copied, setCopied] = useState(false);
  const copyTag = () => {
    // Where the browser keeps the clipboard from the page, the tag is still
    // on the screen to type.
    void navigator.clipboard
      ?.writeText(tag)
      .then(() => setCopied(true))
      .catch(() => {});
  };
  return (
    <>
      <ol className="paper-pay-steps">
        <li>Open your banking app and find Zelle®.</li>
        <li>
          Send to the Zelle® tag <strong className="paper-pay-tag">{tag}</strong>. It shows as{" "}
          {ExpandBusiness.letterheadName}.
          <button type="button" className="paper-btn" onClick={copyTag}>
            {copied ? "Copied" : "Copy tag"}
          </button>
        </li>
        <li>
          Amount <strong>{amount}</strong>. Put <strong>{invoiceNumber}</strong> in the memo.
        </li>
      </ol>
      <p className="paper-pay-text">
        We mark the invoice paid when the money lands, usually the same day.
      </p>
      {/* Zelle's own page for the tag, the address inside the bank's QR code.
          A few big banks pass the tag on into their app from it; most only
          say to scan the code in a banking app, so the steps stay the way. */}
      <p className="paper-pay-text paper-pay-try">
        <a className="paper-btn" href={zelleQrUrl(tag)} target="_blank" rel="noreferrer">
          Try opening it in your bank’s app
        </a>
        <span>Works with some banks; the steps above always do.</span>
      </p>
    </>
  );
}

// Pay by check: whom to make it out to and where it goes. Until Expand has a
// mailing address, a check is handed over in person and the sheet says only
// that.
function CheckSteps({
  mailingAddress,
  amount,
  invoiceNumber,
}: {
  mailingAddress: string | null;
  amount: string;
  invoiceNumber: string;
}) {
  return (
    <>
      <ol className="paper-pay-steps">
        <li>
          Make the check out to <strong>{ExpandBusiness.letterheadName}</strong> for{" "}
          <strong>{amount}</strong>, with <strong>{invoiceNumber}</strong> on the memo line.
        </li>
        <li>
          {mailingAddress
            ? `Hand it to us in person, or mail it to ${mailingAddress}.`
            : "Hand it to us in person."}
        </li>
      </ol>
      <p className="paper-pay-text">
        We mark the invoice paid when the check clears, usually within a few days.
      </p>
    </>
  );
}
