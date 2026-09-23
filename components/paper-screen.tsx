"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { ProposalPaper } from "@/components/proposal-paper";
import { Skeleton } from "@/components/ui/skeleton";
import { loadPaperFonts } from "@/lib/paper-fonts";
import { paperImagesSettled } from "@/lib/paper-images";
import { paperScale, paperTitle, type PaperProposal } from "@/lib/proposal-paper";

// The screen a **Proposal paper** is read on: white letter pages on a grey
// backdrop, under a sticky bar carrying Expand's mark and which proposal this
// is (app/paper-screen.css). Ported from FRSG's paper-screen.tsx. The staff
// paper draws it today; the signing link draws the same screen with a sign bar
// over it.
//
// On a screen narrower than the paper the whole document is scaled down rather
// than reflowed, so the page a customer reads on a phone is the page that
// prints. A transform takes no room in the layout, so the height the wrapper
// would have had is measured here and given back to it.
//
// The root says `data-paper="ready"` once the paper's faces and the
// letterhead's image have arrived, which is what a print has to wait for.

// The one sentence under the top bar, and the colour it is said in.
export type PaperStrip = {
  tone: "note";
  body: ReactNode;
};

export function PaperScreen({
  paper,
  strip,
}: {
  paper: PaperProposal;
  // What the page has to say about where the proposal stands, if anything.
  strip?: PaperStrip;
}) {
  const { scale, sheetsRef, naturalHeight } = usePaperFit();
  const ready = usePaperReady();
  const scaled = scale < 1;

  return (
    <div
      className="paper-screen"
      data-paper={ready ? "ready" : "loading"}
      style={{ ["--paper-scale" as string]: String(scale) }}
    >
      <PaperTop title={paperTitle(paper.number, paper.name)}>
        {strip ? (
          <div className={`paper-strip paper-strip-${strip.tone}`}>{strip.body}</div>
        ) : null}
      </PaperTop>

      <div className="paper-sheets" ref={sheetsRef}>
        <div
          className={scaled ? "paper-sheets-scaled" : undefined}
          // The room the scaled sheets take. Until the document has been
          // measured the wrapper holds whatever the transform left, which is
          // one frame of a slightly long page and never a short one.
          style={scaled && naturalHeight !== null ? { height: naturalHeight * scale } : undefined}
        >
          <ProposalPaper proposal={paper} />
        </div>
      </div>
    </div>
  );
}

// The page's shape before its proposal arrives: the backdrop and one sheet's
// worth of space, so nothing jumps when the paper fills in.
export function PaperLoading() {
  return (
    <div className="paper-screen" data-paper="loading">
      <PaperTop title="" />
      <div className="paper-sheets">
        <div className="proposal-document">
          <div className="pd-page">
            <Skeleton className="h-4 w-40 bg-stone-200" />
            <Skeleton className="mt-3 h-6 w-72 bg-stone-200" />
            <Skeleton className="mt-6 h-40 w-full bg-stone-100" />
          </div>
        </div>
      </div>
    </div>
  );
}

function PaperTop({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="paper-top">
      <div className="paper-top-row">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="paper-brand" src="/logo.svg" alt="Expand Handyman" />
        <span className="paper-title">{title}</span>
      </div>
      {children}
    </header>
  );
}

// The scale a letter page is drawn at, and the room the scaled sheets take.
// The scale is measured from the box the sheets sit in and never from the
// window, so scaling can never change what it was measured from. The height
// is the document's own, measured before the transform and re-measured
// whenever the document changes shape — a face arriving, say.
function usePaperFit() {
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
  }, []);

  return { scale, sheetsRef, naturalHeight };
}

// Whether everything the paper is drawn with has arrived: its faces, and the
// letterhead's image.
function usePaperReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let current = true;
    void loadPaperFonts()
      .then(() => paperImagesSettled())
      .then(() => {
        if (current) setReady(true);
      });
    return () => {
      current = false;
    };
  }, []);
  return ready;
}
