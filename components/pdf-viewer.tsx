"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { Button } from "./ui/button";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import type { SignatureField } from "@/lib/signing";
import { cn, errorMessage } from "@/lib/utils";
export function PdfViewer({
  bytes,
  fields = [],
  onChange,
  page,
  onPageChange,
  name = "",
  selected,
  onSelect,
}: {
  bytes: Uint8Array;
  fields?: SignatureField[];
  onChange?: (fields: SignatureField[]) => void;
  page: number;
  onPageChange: (page: number) => void;
  name?: string;
  selected?: string;
  onSelect?: (id: string) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [pdfPage, setPdfPage] = useState<PDFPageProxy>();
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const drag = useRef<
    { id: string; offsetX: number; offsetY: number } | undefined
  >(undefined);
  useEffect(() => {
    let active = true;
    let doc: PDFDocumentProxy | undefined;
    let task:
      ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    setError("");
    setPdf(undefined);
    void import("pdfjs-dist")
      .then(async (mod) => {
        mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        task = mod.getDocument({ data: bytes.slice() });
        doc = await task.promise;
        if (active) setPdf(doc);
        else void task.destroy();
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
      void task?.destroy();
    };
  }, [bytes]);
  useEffect(() => {
    let active = true;
    setPdfPage(undefined);
    if (pdf)
      void pdf
        .getPage(Math.min(page + 1, pdf.numPages))
        .then((p) => {
          if (active) setPdfPage(p);
        })
        .catch((e) => setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [pdf, page]);
  useEffect(() => {
    if (!container.current) return;
    const obs = new ResizeObserver(([entry]) =>
      setWidth(Math.min(850, entry.contentRect.width)),
    );
    obs.observe(container.current);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (!pdfPage || !canvas.current) return;
    const viewport = pdfPage.getViewport({
      scale: width / pdfPage.getViewport({ scale: 1 }).width,
    });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const c = canvas.current;
    c.width = viewport.width * ratio;
    c.height = viewport.height * ratio;
    const task = pdfPage.render({
      canvas: c,
      viewport,
      transform: [ratio, 0, 0, ratio, 0, 0],
    });
    void task.promise.catch((e) => {
      if (e.name !== "RenderingCancelledException") setError(errorMessage(e));
    });
    return () => task.cancel();
  }, [pdfPage, width]);
  const view = pdfPage?.getViewport({ scale: 1 });
  return (
    <div ref={container} className="min-w-0">
      <div className="mb-4 flex items-center justify-center gap-4">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous page"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="text-xs tabular-nums">
          Page {page + 1} of {pdf?.numPages ?? "…"}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next page"
          disabled={!pdf || page >= pdf.numPages - 1}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 p-5 text-sm text-destructive"
        >
          {error}
        </p>
      ) : (
        <div
          className="relative mx-auto bg-white shadow-sm ring-1 ring-black/10"
          style={{
            width: Math.min(width, 850),
            aspectRatio: view ? `${view.width}/${view.height}` : "612/792",
          }}
        >
          <canvas
            ref={canvas}
            className="block h-full w-full"
            aria-label={`Document page ${page + 1}`}
          />
          {fields
            .filter((f) => f.page === page)
            .map((f, index) => (
              <button
                type="button"
                key={f.id}
                aria-label={`Signature field ${index + 1}${onChange ? ", drag to move" : ""}`}
                onClick={() => onSelect?.(f.id)}
                onKeyDown={(e) => {
                  if (!onChange) return;
                  const delta = 0.005;
                  let x = f.x,
                    y = f.y;
                  if (e.key === "ArrowLeft") x -= delta;
                  else if (e.key === "ArrowRight") x += delta;
                  else if (e.key === "ArrowUp") y -= delta;
                  else if (e.key === "ArrowDown") y += delta;
                  else return;
                  e.preventDefault();
                  onChange(
                    fields.map((item) =>
                      item.id === f.id
                        ? {
                            ...f,
                            x: Math.max(0, Math.min(1 - f.width, x)),
                            y: Math.max(0, Math.min(1 - f.height, y)),
                          }
                        : item,
                    ),
                  );
                }}
                onPointerDown={(e) => {
                  if (!onChange) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const box = e.currentTarget.getBoundingClientRect();
                  drag.current = {
                    id: f.id,
                    offsetX: e.clientX - box.left,
                    offsetY: e.clientY - box.top,
                  };
                  onSelect?.(f.id);
                }}
                onPointerMove={(e) => {
                  if (!onChange || drag.current?.id !== f.id) return;
                  const parent =
                    e.currentTarget.parentElement!.getBoundingClientRect();
                  const x = Math.max(
                    0,
                    Math.min(
                      1 - f.width,
                      (e.clientX - parent.left - drag.current.offsetX) /
                        parent.width,
                    ),
                  );
                  const y = Math.max(
                    0,
                    Math.min(
                      1 - f.height,
                      (e.clientY - parent.top - drag.current.offsetY) /
                        parent.height,
                    ),
                  );
                  onChange(
                    fields.map((item) =>
                      item.id === f.id ? { ...f, x, y } : item,
                    ),
                  );
                }}
                onPointerUp={() => {
                  drag.current = undefined;
                }}
                onPointerCancel={() => {
                  drag.current = undefined;
                }}
                className={cn(
                  "absolute flex touch-none items-center justify-center overflow-hidden rounded border-2 text-xs",
                  onChange
                    ? "cursor-grab border-primary/70 bg-primary/10 active:cursor-grabbing"
                    : "border-primary/40 bg-primary/5",
                  selected === f.id && "ring-2 ring-primary ring-offset-2",
                )}
                style={{
                  left: `${f.x * 100}%`,
                  top: `${f.y * 100}%`,
                  width: `${f.width * 100}%`,
                  height: `${f.height * 100}%`,
                }}
              >
                {name ? (
                  <span
                    className="signature-ink truncate px-1"
                    style={{
                      fontSize: Math.min(
                        32,
                        f.height *
                          (view ? (width / view.width) * view.height : width) *
                          0.65,
                      ),
                    }}
                  >
                    {name}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-foreground">
                    {onChange && <GripVertical size={13} />}Sign here
                  </span>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
