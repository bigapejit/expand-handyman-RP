"use client";

import { useEffect } from "react";

import { PrototypeSwitcher, useParamChoice, useVariant } from "@/components/prototype/prototype-switcher";
import { useSidePanel } from "@/components/side-panel";
import { InvoicePanelParam } from "@/lib/invoices";

import { InvoicePanelPrototype } from "./invoice-panel";
import { actions, useStore, type Mode } from "./store";
import { VariantAPage } from "./variant-a-page";
import { VariantBInvoices } from "./variant-b-invoices";
import { VariantCDashboard } from "./variant-c-dashboard";

// PROTOTYPE (#130): throwaway. Three homes for money that landed in the
// bank, `?variant=A|B|C`; two ways a clear match is handled, `?mode=`; and
// Relay's login state, `?relay=`. Opening an invoice from any of them shows
// the panel's Payment block. Nothing here saves: reload to start over.
//
//   A  Money in page    its own page in the nav, with a count badge
//   B  Invoices page    a Money in segment; a deposit shows under the invoice it fits
//   C  Dashboard card   only what is waiting; nothing else anywhere
//
//   confirm  the app suggests, the owner taps Confirm
//   auto     one exact match marks itself paid; the owner can Undo

export const Variants = [
  { key: "A", name: "Money in page" },
  { key: "B", name: "On Invoices" },
  { key: "C", name: "Dashboard card" },
] as const;
export const VariantKeys = ["A", "B", "C"] as const;

const Modes = [
  { key: "confirm", name: "Suggest, you confirm" },
  { key: "auto", name: "Marks itself, Undo" },
] as const;
const ModeKeys = ["confirm", "auto"] as const;

const Relays = [
  { key: "ok", name: "Relay fine" },
  { key: "login", name: "Relay needs a login" },
] as const;
const RelayKeys = ["ok", "login"] as const;

export function MoneyInPrototype() {
  const variant = useVariant(VariantKeys);
  const mode = useParamChoice("mode", ModeKeys) as Mode;
  const relay = useParamChoice("relay", RelayKeys);
  const { statuses } = useStore();
  const { openId, open, close } = useSidePanel(InvoicePanelParam);

  useEffect(() => {
    actions.reset(mode);
  }, [mode]);

  const props = { statuses, relayNeedsLogin: relay === "login", onOpenInvoice: open };
  return (
    <>
      {variant === "A" ? (
        <VariantAPage {...props} />
      ) : variant === "B" ? (
        <VariantBInvoices {...props} />
      ) : (
        <VariantCDashboard {...props} />
      )}
      {openId ? <InvoicePanelPrototype invoiceId={openId} statuses={statuses} onClose={close} /> : null}
      <PrototypeSwitcher
        variants={Variants}
        current={variant}
        rows={[
          { param: "mode", choices: Modes, current: mode },
          { param: "relay", choices: Relays, current: relay },
        ]}
      />
    </>
  );
}
