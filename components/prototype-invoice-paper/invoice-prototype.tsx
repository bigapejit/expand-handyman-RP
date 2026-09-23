"use client";

// PROTOTYPE (issue #68): throwaway. The paper screen around the invoice paper
// (the top bar, the strip, the sheets fitted to the screen, as
// components/paper-screen.tsx draws them for a proposal) and a floating bar to
// flip between the invoice's states. Download prints the page; the real thing
// goes through the PDF renderer. Nothing is saved.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { paperDate, paperScale } from "@/lib/proposal-paper";

import { Variants, invoiceFor } from "./fixtures";
import { InvoicePaper } from "./invoice-paper";

export function InvoicePrototype({ variant }: { variant: string }) {
  const invoice = invoiceFor(variant);
  const { scale, sheetsRef, naturalHeight } = usePaperFit(variant);
  const scaled = scale < 1;

  const strip =
    invoice.paidOn !== undefined
      ? { tone: "signed", body: `Paid on ${paperDate(invoice.paidOn)}. Thank you.` }
      : invoice.voidedOn !== undefined
        ? {
            tone: "declined",
            body: `Expand Handyman voided this invoice on ${paperDate(invoice.voidedOn)}. Nothing is due on it.`,
          }
        : null;

  return (
    <div
      className="paper-screen"
      data-paper="ready"
      style={{ ["--paper-scale" as string]: String(scale) }}
    >
      <header className="paper-top">
        <div className="paper-top-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="paper-brand" src="/logo.svg" alt="Expand Handyman" />
          <span className="paper-title">
            Invoice {invoice.number} · {invoice.site.street}
          </span>
          <button type="button" className="paper-btn" onClick={() => window.print()}>
            Download PDF
          </button>
        </div>
        {strip ? <div className={`paper-strip paper-strip-${strip.tone}`}>{strip.body}</div> : null}
      </header>

      <div className="paper-sheets" ref={sheetsRef}>
        <div
          className={scaled ? "paper-sheets-scaled" : undefined}
          style={scaled && naturalHeight !== null ? { height: naturalHeight * scale } : undefined}
        >
          <InvoicePaper invoice={invoice} />
        </div>
      </div>

      {process.env.NODE_ENV !== "production" ? <Switcher variant={variant} /> : null}
    </div>
  );
}

// The floating bar: previous, which state this is, next. Arrow keys work too.
function Switcher({ variant }: { variant: string }) {
  const router = useRouter();
  const index = Math.max(
    0,
    Variants.findIndex((candidate) => candidate.key === variant),
  );
  const go = (step: number) => {
    const next = Variants[(index + step + Variants.length) % Variants.length];
    router.replace(`?variant=${next.key}`);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest("input, textarea, [contenteditable]") !== null) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="ip-switcher">
      <button type="button" onClick={() => go(-1)} aria-label="Previous">
        ←
      </button>
      <span>
        {index + 1}/{Variants.length} · {Variants[index].label}
      </span>
      <button type="button" onClick={() => go(1)} aria-label="Next">
        →
      </button>
    </div>
  );
}

// components/paper-screen.tsx's usePaperFit, re-measured when the variant
// changes.
function usePaperFit(variant: string) {
  const [scale, setScale] = useState(1);
  const [naturalHeight, setNaturalHeight] = useState<number | null>(null);
  const sheetsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sheets = sheetsRef.current;
    if (!sheets) return;
    const measure = () => setScale(paperScale(sheets.clientWidth));
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
  }, [variant]);

  return { scale, sheetsRef, naturalHeight };
}
