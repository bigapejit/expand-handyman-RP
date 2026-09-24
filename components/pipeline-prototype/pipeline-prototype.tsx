"use client";

// PROTOTYPE. Round 1 asked which page layout: `?variant=A|B|C` (Board,
// Worklist, Workbench). The owner picked A, the Board. Round 2 asks what the
// panel that opens over a card should be, `?panel=1|2|3`:
//   1  Chat      a message thread with a stepper on top and a composer below
//   2  Cards     a progress bar, Now + Details cards, notes as a dated list
//   3  Journal   stage as a menu chip, next step as one line, diary below
//   4  Quick     round 3, the default: Thumbtack button, copy fields, stage,
//                one notes field, Take photo, Add to Google Calendar
// The floating bar now cycles the panel. B and C stay reachable by URL.
// Seeded in memory plus the real Thumbtack leads. Reload resets everything.

import { LoaderCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { DealStoreProvider } from "@/components/pipeline-prototype/store";
import { VariantBoard, type PanelVariant } from "@/components/pipeline-prototype/variant-board";
import { VariantWorkbench } from "@/components/pipeline-prototype/variant-workbench";
import { VariantWorklist } from "@/components/pipeline-prototype/variant-worklist";
import { PrototypeSwitcher } from "@/components/prototype-switcher";

const PANELS = [
  { key: "4", name: "Quick" },
  { key: "1", name: "Chat" },
  { key: "2", name: "Cards" },
  { key: "3", name: "Journal" },
];

export function PipelinePrototype() {
  const params = useSearchParams();
  const variant = params.get("variant")?.toUpperCase() ?? "A";
  const panelParam = params.get("panel") ?? "4";
  const panel: PanelVariant =
    panelParam === "1" || panelParam === "2" || panelParam === "3" ? panelParam : "4";

  // Seeds are built from the clock, so the page waits for the browser rather
  // than hydrating against a server render made a moment earlier.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted)
    return (
      <div className="grid min-h-64 place-items-center rounded-2xl border bg-white">
        <LoaderCircle aria-label="Loading" className="size-6 animate-spin text-slate-500" />
      </div>
    );

  return (
    <DealStoreProvider>
      {variant === "B" ? <VariantWorklist /> : variant === "C" ? <VariantWorkbench /> : <VariantBoard panel={panel} />}
      {variant === "B" || variant === "C" ? null : (
        <PrototypeSwitcher variants={PANELS} current={panel} param="panel" />
      )}
    </DealStoreProvider>
  );
}
