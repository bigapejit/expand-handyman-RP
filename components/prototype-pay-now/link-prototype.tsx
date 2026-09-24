"use client";

import { useState } from "react";

import { InvoicePaper } from "@/components/invoice-paper";
import { PaperFrame, PaperTop, Strip, type PaperStrip } from "@/components/paper-screen";
import {
  PrototypeSwitcher,
  useParamChoice,
  useVariant,
} from "@/components/prototype/prototype-switcher";
import { invoiceMoney } from "@/lib/invoice-money";
import { invoiceLinkStrip, invoicePaperTitle, type PaperInvoice } from "@/lib/invoice-paper";
import { formatCentsExact } from "@/lib/money";

import {
  AcceptedOn,
  linkInvoice,
  PaidOn,
  payChoices,
  Readings,
  shortDay,
  ZelleQrUrl,
  ZelleTag,
  type PayChoice,
  type Reading,
} from "./fixtures";

// PROTOTYPE (#112): throwaway. Three places Pay now could live on the
// invoice link, on the real paper screen with the real invoice paper,
// switched with `?variant=A|B|C`, and four readings of the invoice switched
// with `?reading=`. Pressing a way to pay opens a stand-in for Stripe's
// checkout page; paying there moves the page on, in memory only: bank to
// "Payment on its way", card to PAID.
//
//   A  A pay bar pinned to the bottom, like the sign bar.
//   B  A card of the two choices between the top bar and the paper.
//   C  One Pay button in the top bar, which opens a sheet of the two choices.

//   D  (added after the walk on 2026-09-23) One black Pay button in the
//      bottom bar, which opens a sheet of three: bank, card, Zelle. Zelle
//      shows the tag, the amount and the invoice number for the memo, since
//      no link can open the customer's banking app with those filled in.

const Variants = [
  { key: "D", name: "Pay button, then bank, card, Zelle" },
  { key: "A", name: "Pay bar at the bottom" },
  { key: "B", name: "Choices above the paper" },
  { key: "C", name: "Pay button, then a sheet" },
] as const;
const VariantKeys = ["D", "A", "B", "C"] as const;
type Variant = (typeof VariantKeys)[number];
const ReadingKeys = ["unpaid", "small", "onway", "paid"] as const;
// `?show=` opens a state a press would reach, for screenshots: the sheet, the
// Zelle step, or the stand-in checkout for bank or card.
const ShowKeys = ["", "sheet", "zelle", "check", "bank", "card"] as const;
type Show = (typeof ShowKeys)[number];

export function LinkPrototype() {
  const variant = useVariant(VariantKeys);
  const reading = useParamChoice("reading", ReadingKeys);
  const show = useParamChoice("show", ShowKeys);
  return (
    <>
      <LinkPage
        key={`${variant}-${reading}-${show}`}
        variant={variant}
        reading={reading}
        show={show}
      />
      <PrototypeSwitcher
        variants={Variants}
        current={variant}
        readings={Readings}
        reading={reading}
      />
    </>
  );
}

type Outcome = null | "bank" | "card";
type LinkState = "unpaid" | "onway" | "paid";

function LinkPage({
  variant,
  reading,
  show,
}: {
  variant: Variant;
  reading: Reading;
  show: Show;
}) {
  const base = linkInvoice(reading);
  const startChoices = payChoices(invoiceMoney(base.lines, base.taxRate).amountDueCents);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [checkout, setCheckout] = useState<PayChoice | null>(
    show === "bank" ? startChoices[0] : show === "card" ? startChoices[1] : null,
  );
  const [sheet, setSheet] = useState(
    show === "sheet" || show === "zelle" || show === "check",
  );
  // D's sheet, turned to the Zelle or the check step.
  const [step, setStep] = useState<SheetStep>(
    show === "zelle" ? "zelle" : show === "check" ? "check" : null,
  );

  const state: LinkState =
    outcome === "bank" || reading === "onway"
      ? "onway"
      : outcome === "card" || reading === "paid"
        ? "paid"
        : "unpaid";
  const paper: PaperInvoice =
    state === "paid" && !base.stamp ? { ...base, stamp: { kind: "paid", day: PaidOn } } : base;
  const money = invoiceMoney(paper.lines, paper.taxRate);
  const amount = formatCentsExact(money.amountDueCents);
  const choices = payChoices(money.amountDueCents);
  const pay = (choice: PayChoice) => {
    setSheet(false);
    setCheckout(choice);
  };

  // What the strip under the top bar says: the stamped sentence as today, and
  // in C the on-its-way sentence too.
  const strip: PaperStrip | undefined =
    state === "paid"
      ? invoiceLinkStrip(paper.stamp)
      : state === "onway" && variant === "C"
        ? { tone: "note", body: onItsWay(amount) }
        : undefined;

  const top = (
    <>
      <PaperTop
        title={invoicePaperTitle(paper)}
        actions={
          <>
            {variant === "C" && state === "unpaid" ? (
              <button
                type="button"
                className="paper-btn paper-btn-primary"
                onClick={() => setSheet(true)}
              >
                Pay {amount}
              </button>
            ) : null}
            <button type="button" className="paper-btn" disabled>
              Download
            </button>
          </>
        }
      >
        <Strip strip={strip} />
      </PaperTop>
      {variant === "B" && state !== "paid" ? (
        <PayCard state={state} amount={amount} choices={choices} onPay={pay} />
      ) : null}
    </>
  );

  const bar =
    variant === "A" && state !== "paid" ? (
      <PayBar state={state} amount={amount} choices={choices} onPay={pay} />
    ) : variant === "D" && state !== "paid" ? (
      sheet ? (
        <ThreeWaysSheet
          amount={amount}
          invoiceNumber={paper.number}
          choices={choices}
          step={step}
          onStep={setStep}
          onPay={pay}
          onClose={() => {
            setSheet(false);
            setStep(null);
          }}
        />
      ) : (
        <PayButtonBar state={state} amount={amount} onOpen={() => setSheet(true)} />
      )
    ) : variant === "C" && sheet ? (
      <PaySheet amount={amount} choices={choices} onPay={pay} onClose={() => setSheet(false)} />
    ) : undefined;

  return (
    <>
      <PaperFrame top={top} bar={bar}>
        <InvoicePaper invoice={paper} />
      </PaperFrame>
      {checkout ? (
        <FakeCheckout
          invoiceNumber={paper.number}
          amountDueCents={money.amountDueCents}
          choice={checkout}
          onBack={() => setCheckout(null)}
          onPaid={() => {
            setOutcome(checkout.method);
            setCheckout(null);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      ) : null}
    </>
  );
}

// ── The words ────────────────────────────────────────────────────────────
function onItsWay(amount: string): string {
  return `Your bank payment of ${amount} is on its way. Banks take up to 4 business days to confirm it, and this invoice will read Paid once they do.`;
}

// The line beside the choices: no fee when both are offered, and why there
// is no card button when there is not. Whether the link should explain the
// missing button at all is for the owner to say.
function waysSentence(choices: PayChoice[]): string {
  return choices.length === 2
    ? "No fee either way. Zelle and check work too: see How to pay on the invoice."
    : "Invoices over $1,000 are paid by bank, or by Zelle or check as How to pay says on the invoice.";
}

// ── A: the pay bar ───────────────────────────────────────────────────────
function PayBar({
  state,
  amount,
  choices,
  onPay,
}: {
  state: LinkState;
  amount: string;
  choices: PayChoice[];
  onPay: (choice: PayChoice) => void;
}) {
  const [bank, card] = choices;
  if (state === "onway")
    return (
      <div className="paper-bar">
        <p className="paper-bar-note">{onItsWay(amount)}</p>
        <div className="paper-bar-row">
          <span className="paper-bar-sum">
            <strong>Payment on its way</strong> · bank payment of {amount} accepted{" "}
            {shortDay(AcceptedOn)}
          </span>
        </div>
      </div>
    );
  return (
    <div className="paper-bar">
      <p className="paper-bar-note">{waysSentence(choices)}</p>
      <div className="paper-bar-row">
        <span className="paper-bar-sum">
          <strong>{amount}</strong> · due on receipt
        </span>
        <span className="paper-grow" />
        {card ? (
          <button type="button" className="paper-btn paper-btn-quiet" onClick={() => onPay(card)}>
            Pay by card
          </button>
        ) : null}
        <button type="button" className="paper-btn paper-btn-primary" onClick={() => onPay(bank)}>
          Pay by bank
        </button>
      </div>
    </div>
  );
}

// ── B: the card of choices above the paper ───────────────────────────────
function PayCard({
  state,
  amount,
  choices,
  onPay,
}: {
  state: LinkState;
  amount: string;
  choices: PayChoice[];
  onPay: (choice: PayChoice) => void;
}) {
  if (state === "onway")
    return (
      <section className="pn-card pn-card-onway">
        <h2 className="pn-card-title">Payment on its way</h2>
        <p className="pn-card-text">{onItsWay(amount)}</p>
      </section>
    );
  return (
    <section className="pn-card">
      <h2 className="pn-card-title">Pay {amount} online</h2>
      <ChoiceRows choices={choices} onPay={onPay} />
      <p className="pn-card-text">{waysSentence(choices)}</p>
    </section>
  );
}

// ── C: the sheet the top bar's button opens ──────────────────────────────
function PaySheet({
  amount,
  choices,
  onPay,
  onClose,
}: {
  amount: string;
  choices: PayChoice[];
  onPay: (choice: PayChoice) => void;
  onClose: () => void;
}) {
  return (
    <div className="paper-bar">
      <div className="paper-bar-sheet">
        <div className="paper-form">
          <div className="paper-form-head">
            <div className="paper-form-sum">
              <strong>{amount}</strong> · due on receipt
            </div>
            <button type="button" className="paper-link" onClick={onClose}>
              Close
            </button>
          </div>
          <ChoiceRows choices={choices} onPay={onPay} />
          <p className="pn-card-text">{waysSentence(choices)}</p>
        </div>
      </div>
    </div>
  );
}

// ── D: one Pay button, then bank, card and Zelle ─────────────────────────
function PayButtonBar({
  state,
  amount,
  onOpen,
}: {
  state: LinkState;
  amount: string;
  onOpen: () => void;
}) {
  if (state === "onway")
    return (
      <div className="paper-bar">
        <p className="paper-bar-note">{onItsWay(amount)}</p>
        <div className="paper-bar-row">
          <span className="paper-bar-sum">
            <strong>Payment on its way</strong> · bank payment of {amount} accepted{" "}
            {shortDay(AcceptedOn)}
          </span>
        </div>
      </div>
    );
  return (
    <div className="paper-bar">
      <div className="paper-bar-row">
        <span className="paper-bar-sum">
          <strong>{amount}</strong> · due on receipt
        </span>
        <span className="paper-grow" />
        <button type="button" className="paper-btn paper-btn-primary" onClick={onOpen}>
          Pay {amount}
        </button>
      </div>
    </div>
  );
}

type SheetStep = null | "zelle" | "check";

// The sheet Pay opens: the ways as rows, or, once Zelle or check is picked,
// what to do.
function ThreeWaysSheet({
  amount,
  invoiceNumber,
  choices,
  step,
  onStep,
  onPay,
  onClose,
}: {
  amount: string;
  invoiceNumber: string;
  choices: PayChoice[];
  step: SheetStep;
  onStep: (step: SheetStep) => void;
  onPay: (choice: PayChoice) => void;
  onClose: () => void;
}) {
  const zelle = step === "zelle";
  const check = step === "check";
  const [bank, card] = choices;
  const [copied, setCopied] = useState(false);
  const copyTag = () => {
    void navigator.clipboard?.writeText(ZelleTag).then(() => setCopied(true));
  };
  return (
    <div className="paper-bar">
      <div className="paper-bar-sheet">
        <div className="paper-form">
          <div className="paper-form-head">
            <div className="paper-form-sum">
              {zelle ? (
                <>
                  Pay <strong>{amount}</strong> by Zelle
                </>
              ) : check ? (
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
              onClick={step ? () => onStep(null) : onClose}
            >
              {step ? "Back" : "Close"}
            </button>
          </div>
          {zelle ? (
            <>
              <ol className="pn-steps">
                <li>Open your banking app and find Zelle®.</li>
                <li>
                  Send to the Zelle® tag <strong className="pn-tag">{ZelleTag}</strong>. It shows
                  as Expand Handyman LLC.{" "}
                  <button type="button" className="paper-btn" onClick={copyTag}>
                    {copied ? "Copied" : "Copy tag"}
                  </button>
                </li>
                <li>
                  Amount <strong>{amount}</strong>. Put <strong>{invoiceNumber}</strong> in the
                  memo.
                </li>
              </ol>
              <p className="pn-card-text">
                We mark the invoice paid when the money lands, usually the same day.
              </p>
              {/* The address inside the bank's QR code. Tapped, it opens Zelle's
                  find-your-bank page; a few big banks then pass the tag into
                  their app, most only say "scan this in your banking app", and
                  the amount never comes along (#116). Here so the owner can
                  judge whether it earns a place. */}
              <p className="pn-card-text">
                <a className="paper-btn" href={ZelleQrUrl} target="_blank" rel="noreferrer">
                  Try opening it in your bank&rsquo;s app
                </a>{" "}
                <span className="pn-choice-note">
                  Works with some banks; the steps above always do.
                </span>
              </p>
            </>
          ) : check ? (
            <>
              <ol className="pn-steps">
                <li>
                  Make the check out to <strong>Expand Handyman LLC</strong> for{" "}
                  <strong>{amount}</strong>, with <strong>{invoiceNumber}</strong> on the memo
                  line.
                </li>
                <li>Hand it to us in person, or mail it to the address at the top of the invoice.</li>
              </ol>
              <p className="pn-card-text">
                We mark the invoice paid when the check clears, usually within a few days.
              </p>
            </>
          ) : (
            <>
              <div className="pn-choices">
                <button type="button" className="pn-choice" onClick={() => onPay(bank)}>
                  <span className="pn-choice-name">Pay by bank</span>
                  <span className="pn-choice-note">
                    From your checking account, through Stripe.
                  </span>
                  <span className="pn-choice-amount">{formatCentsExact(bank.chargeCents)}</span>
                </button>
                {card ? (
                  <button type="button" className="pn-choice" onClick={() => onPay(card)}>
                    <span className="pn-choice-name">Pay by card</span>
                    <span className="pn-choice-note">Credit or debit, on Stripe&rsquo;s page.</span>
                    <span className="pn-choice-amount">{formatCentsExact(card.chargeCents)}</span>
                  </button>
                ) : null}
                <button type="button" className="pn-choice" onClick={() => onStep("zelle")}>
                  <span className="pn-choice-name">Pay by Zelle®</span>
                  <span className="pn-choice-note">From your banking app, to our Zelle® tag.</span>
                  <span className="pn-choice-amount">{amount}</span>
                </button>
                <button type="button" className="pn-choice" onClick={() => onStep("check")}>
                  <span className="pn-choice-name">Pay by check</span>
                  <span className="pn-choice-note">Payable to Expand Handyman LLC.</span>
                  <span className="pn-choice-amount">{amount}</span>
                </button>
              </div>
              <p className="pn-card-text">
                {card ? "No fee on any of them." : "No fee on any of them. Card is for invoices up to $1,000."}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// The two ways, as rows: the way, what it costs, and the figure it comes to.
function ChoiceRows({
  choices,
  onPay,
}: {
  choices: PayChoice[];
  onPay: (choice: PayChoice) => void;
}) {
  const [bank, card] = choices;
  return (
    <div className="pn-choices">
      <button type="button" className="pn-choice" onClick={() => onPay(bank)}>
        <span className="pn-choice-name">Pay by bank</span>
        <span className="pn-choice-note">From your checking account, through Stripe.</span>
        <span className="pn-choice-amount">{formatCentsExact(bank.chargeCents)}</span>
      </button>
      {card ? (
        <button type="button" className="pn-choice" onClick={() => onPay(card)}>
          <span className="pn-choice-name">Pay by card</span>
          <span className="pn-choice-note">Credit or debit, on Stripe&rsquo;s page.</span>
          <span className="pn-choice-amount">{formatCentsExact(card.chargeCents)}</span>
        </button>
      ) : null}
    </div>
  );
}

// ── A stand-in for Stripe's checkout page ────────────────────────────────
// What the customer would see after pressing a way to pay: Stripe's own
// page, with the invoice as its one line. Nothing here is Stripe's; it is a
// sketch, so the loop can be walked end to end.
function FakeCheckout({
  invoiceNumber,
  amountDueCents,
  choice,
  onBack,
  onPaid,
}: {
  invoiceNumber: string;
  amountDueCents: number;
  choice: PayChoice;
  onBack: () => void;
  onPaid: () => void;
}) {
  const charge = formatCentsExact(choice.chargeCents);
  return (
    <div className="pn-checkout" role="dialog" aria-label="Stripe checkout, stand-in">
      <div className="pn-checkout-card">
        <p className="pn-checkout-tag">Stripe Checkout · stand-in, not the real page</p>
        <p className="pn-checkout-merchant">Expand Handyman LLC</p>
        <p className="pn-checkout-pay">Pay {charge}</p>
        <dl className="pn-checkout-lines">
          <dt>Invoice {invoiceNumber}</dt>
          <dd>{formatCentsExact(amountDueCents)}</dd>
          <dt className="pn-checkout-total">Total due</dt>
          <dd className="pn-checkout-total">{charge}</dd>
        </dl>
        <p className="pn-checkout-method">
          {choice.method === "bank"
            ? "Bank account (ACH debit): Stripe signs you in to your bank, or takes routing and account numbers."
            : "Card: number, expiry and CVC, on Stripe's page. Expand never sees them."}
        </p>
        <div className="paper-actions">
          <button type="button" className="paper-btn paper-btn-primary" onClick={onPaid}>
            Pay {charge}
          </button>
          <button type="button" className="paper-btn paper-btn-quiet" onClick={onBack}>
            Back to the invoice
          </button>
        </div>
      </div>
    </div>
  );
}
