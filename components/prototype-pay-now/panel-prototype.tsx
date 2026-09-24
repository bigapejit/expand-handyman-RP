"use client";

import {
  Ban,
  CircleCheck,
  Copy,
  Download,
  ExternalLink,
  Eye,
  RotateCcw,
  Undo2,
} from "lucide-react";

import { InvoiceChip } from "@/components/invoice-chips";
import { PrototypeSwitcher, useVariant } from "@/components/prototype/prototype-switcher";
import { FieldHeading, FieldLabel, SidePanel, useSidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { invoiceTaxLabel } from "@/lib/invoice-paper";
import { InvoicePanelParam } from "@/lib/invoices";
import { formatCentsExact } from "@/lib/money";
import { cn } from "@/lib/utils";

import { PanelInvoices, shortDay, type PanelFixture, type PanelStanding } from "./fixtures";

// PROTOTYPE (#112): throwaway. The invoice panel's payment block for every
// kind of payment, over a made-up Invoices list in the real staff shell,
// opened the way the real panel opens (`?invoice=`). Two variants of the
// block, switched with `?variant=A|B`:
//
//   A  One sentence in the green box, as the block reads today.
//   B  A record: the day on one line, how it was paid under it.

const Variants = [
  { key: "A", name: "One sentence" },
  { key: "B", name: "A record" },
] as const;
const VariantKeys = ["A", "B"] as const;
type Variant = (typeof VariantKeys)[number];

export function PanelPrototype() {
  const variant = useVariant(VariantKeys);
  const { openId, open, close } = useSidePanel(InvoicePanelParam);
  const invoice = PanelInvoices.find((row) => row.invoiceId === openId) ?? null;
  return (
    <>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">
            Invoices{" "}
            <span className="text-sm font-medium text-fuchsia-700">prototype, ticket #112</span>
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Five made-up invoices, one for each way the money can arrive. Open one to see its
            payment block. Nothing here saves.
          </p>
        </div>
        <ul className="divide-y overflow-hidden rounded-xl border bg-white">
          {PanelInvoices.map((row) => (
            <li key={row.invoiceId}>
              <button
                type="button"
                onClick={() => open(row.invoiceId)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium text-slate-900">{row.title}</span>
                <span className="text-slate-500">
                  {row.customerName} · {row.proposalCode}
                </span>
                <span className="flex-1" />
                <span className="tabular-nums text-slate-900">
                  {formatCentsExact(row.money.amountDueCents)}
                </span>
                <StandingChip standing={row.standing} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      {invoice ? <Panel invoice={invoice} variant={variant} onClose={close} /> : null}
      <PrototypeSwitcher variants={Variants} current={variant} />
    </>
  );
}

// The real chip for the standings it knows, and a fourth for a payment on
// its way.
function StandingChip({ standing }: { standing: PanelStanding }) {
  if (standing === "onway")
    return (
      <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
        Payment on its way
      </span>
    );
  return <InvoiceChip state="sent" standing={standing} />;
}

function Panel({
  invoice,
  variant,
  onClose,
}: {
  invoice: PanelFixture;
  variant: Variant;
  onClose: () => void;
}) {
  // Void is refused while a payment stands, and while one is on its way.
  const voidable = invoice.payment === null && invoice.pending === null;
  return (
    <SidePanel
      title={invoice.title}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          <span>{invoice.customerName}</span>
          <span aria-hidden>·</span>
          <span>{invoice.proposalCode}</span>
          <StandingChip standing={invoice.standing} />
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-6 pt-5">
        <Lines invoice={invoice} />
        <LinkBlock invoice={invoice} />
        <div className="space-y-2">
          <FieldHeading>Payment</FieldHeading>
          {variant === "A" ? <PaymentSentence invoice={invoice} /> : <PaymentRecord invoice={invoice} />}
        </div>
        <div className="flex flex-wrap items-center gap-1 border-t pt-4">
          <Button variant="outline">
            <Eye data-icon="inline-start" aria-hidden /> View paper
          </Button>
          <Button variant="outline">
            <Download data-icon="inline-start" aria-hidden /> Download PDF
          </Button>
          <span className="flex-1" />
          {voidable ? (
            <Button variant="outline">
              <Ban data-icon="inline-start" aria-hidden /> Void
            </Button>
          ) : null}
        </div>
      </div>
    </SidePanel>
  );
}

// ── A: one sentence, in the box the block uses today ─────────────────────
function PaymentSentence({ invoice }: { invoice: PanelFixture }) {
  const { payment, pending } = invoice;
  const amount = formatCentsExact(invoice.money.amountDueCents);
  if (pending)
    return (
      <>
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Payment on its way.</strong> A bank payment of {amount} was accepted{" "}
          {shortDay(pending.acceptedOn)} through Stripe. Banks take up to 4 business days to
          confirm it, and the invoice reads Paid once they do.
        </p>
        <StripeLink href={pending.stripeUrl}>See it in Stripe</StripeLink>
      </>
    );
  if (!payment) return <MarkPaid />;
  return (
    <>
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        Paid {shortDay(payment.receivedOn)}, {howPaid(payment)}.
      </p>
      {payment.source === "owner" ? (
        <Button variant="outline">
          <Undo2 data-icon="inline-start" aria-hidden /> Mark unpaid
        </Button>
      ) : (
        <StripeLink href={payment.stripeUrl}>See the payment in Stripe</StripeLink>
      )}
    </>
  );
}

// ── B: a record, the day over how it was paid ────────────────────────────
function PaymentRecord({ invoice }: { invoice: PanelFixture }) {
  const { payment, pending } = invoice;
  const amount = formatCentsExact(invoice.money.amountDueCents);
  if (pending)
    return (
      <Record
        tone="amber"
        head="Payment on its way"
        body={`Bank payment of ${amount} accepted ${shortDay(pending.acceptedOn)} through Stripe. Usually confirmed within 4 business days.`}
        aside={<StripeLink href={pending.stripeUrl}>Open in Stripe</StripeLink>}
      />
    );
  if (!payment) return <MarkPaid />;
  return (
    <Record
      tone="green"
      head={`Paid ${shortDay(payment.receivedOn)}`}
      body={capitalize(howPaid(payment))}
      aside={
        payment.source === "owner" ? (
          <Button variant="outline" size="sm">
            <Undo2 data-icon="inline-start" aria-hidden /> Mark unpaid
          </Button>
        ) : (
          <StripeLink href={payment.stripeUrl}>Open in Stripe</StripeLink>
        )
      }
    />
  );
}

function Record({
  tone,
  head,
  body,
  aside,
}: {
  tone: "green" | "amber";
  head: string;
  body: string;
  aside: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border px-3 py-3 text-sm">
      <div className="min-w-0">
        <p
          className={cn(
            "font-semibold",
            tone === "green" ? "text-emerald-800" : "text-amber-800",
          )}
        >
          {head}
        </p>
        <p className="text-slate-600">{body}</p>
      </div>
      <div className="shrink-0">{aside}</div>
    </div>
  );
}

// ── Shared ───────────────────────────────────────────────────────────────
// The words after the day, the same for every payment: who or what recorded
// it, and for Stripe's, how the money moved.
function howPaid(payment: NonNullable<PanelFixture["payment"]>): string {
  if (payment.source === "owner") return "marked by you";
  return payment.method === "card" ? "by card through Stripe" : "by bank through Stripe";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function StripeLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button
      variant="outline"
      size="sm"
      nativeButton={false}
      render={<a href={href} target="_blank" rel="noreferrer" />}
    >
      {children} <ExternalLink data-icon="inline-end" aria-hidden />
    </Button>
  );
}

// Mark paid as it is today, for the one unpaid invoice, so the block can be
// read against it.
function MarkPaid() {
  return (
    <>
      <p className="text-sm text-slate-600">
        Once the money is in, mark it paid. Its link then shows the paper stamped PAID.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <FieldLabel htmlFor="pn-received-on">Money arrived on</FieldLabel>
          <Input id="pn-received-on" type="date" className="w-44" defaultValue="2026-09-23" />
        </div>
        <Button>
          <CircleCheck data-icon="inline-start" aria-hidden /> Mark paid
        </Button>
      </div>
    </>
  );
}

function Lines({ invoice }: { invoice: PanelFixture }) {
  const { money } = invoice;
  return (
    <div className="space-y-2">
      <FieldHeading>Lines</FieldHeading>
      <div className="overflow-hidden rounded-xl border text-sm">
        <ol className="divide-y">
          {invoice.lines.map((line, index) => (
            <li key={index} className="flex items-start justify-between gap-4 px-3 py-2">
              <span className="min-w-0 text-slate-900">{line.description}</span>
              <span className="shrink-0 tabular-nums text-slate-900">
                {formatCentsExact(line.cents)}
              </span>
            </li>
          ))}
        </ol>
        <dl className="space-y-1 border-t bg-slate-50 px-3 py-2">
          <div className="flex justify-between text-slate-600">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{formatCentsExact(money.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between text-slate-600">
            <dt>{invoiceTaxLabel(invoice.taxRate)}</dt>
            <dd className="tabular-nums">{formatCentsExact(money.taxCents)}</dd>
          </div>
          <div className="flex justify-between font-semibold text-slate-900">
            <dt>Amount Due</dt>
            <dd className="tabular-nums">{formatCentsExact(money.amountDueCents)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function LinkBlock({ invoice }: { invoice: PanelFixture }) {
  return (
    <div className="space-y-2">
      <FieldHeading>Invoice link</FieldHeading>
      <div className="space-y-2 rounded-xl border px-3 py-3 text-sm">
        <p className="flex flex-wrap gap-x-2 text-xs text-slate-500">
          <span className="text-slate-900">{invoice.sentTo}</span>
          <span>Emailed</span>
        </p>
        <p className="break-all rounded-md bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700">
          https://staff.expandhandyman.com/sign/prototype-{invoice.invoiceId}
        </p>
        <Button variant="outline" size="sm">
          <Copy data-icon="inline-start" aria-hidden /> Copy link
        </Button>
      </div>
      <Button variant="outline">
        <RotateCcw data-icon="inline-start" aria-hidden /> Re-send
      </Button>
    </div>
  );
}
