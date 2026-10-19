"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { Button } from "./ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  FIELD_LABELS,
  fieldKind,
  isDateField,
  isOwnerField,
  resizeField,
  signingDate,
  type SignatureField,
  type OwnerSignature,
} from "@/lib/signing";
import { cn, errorMessage } from "@/lib/utils";

type FieldsProps = {
  fields?: SignatureField[];
  onChange?: (fields: SignatureField[]) => void;
  name?: string;
  owner?: OwnerSignature;
  selected?: string;
  onSelect?: (id: string) => void;
  onSignHere?: () => void;
};
function usePdf(bytes: Uint8Array) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let task:
      | ReturnType<(typeof import("pdfjs-dist"))["getDocument"]>
      | undefined;
    setPdf(undefined);
    setError("");
    void import("pdfjs-dist")
      .then(async (mod) => {
        if (!active) return;
        mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        task = mod.getDocument({
          data: bytes.slice(),
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
        });
        const result = await task.promise;
        if (active) setPdf(result);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
      void task?.destroy();
    };
  }, [bytes]);
  return { pdf, error };
}

export function PdfViewer({
  bytes,
  page,
  onPageChange,
  ...props
}: FieldsProps & {
  bytes: Uint8Array;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const { pdf, error } = usePdf(bytes);
  return (
    <div className="min-w-0">
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
        <p role="alert">{error}</p>
      ) : pdf ? (
        <PdfPage key={page} pdf={pdf} page={page} {...props} />
      ) : (
        <p className="p-8 text-center text-sm">Loading PDF…</p>
      )}
    </div>
  );
}

// FRSG presents one continuous stack of paper, not a paginated preview panel.
export function PdfPages({
  bytes,
  ...props
}: FieldsProps & { bytes: Uint8Array }) {
  const { pdf, error } = usePdf(bytes);
  return (
    <div className="paper-pdf-pages">
      {error ? (
        <p role="alert" className="paper-strip paper-strip-fault">
          {error}
        </p>
      ) : pdf ? (
        Array.from({ length: pdf.numPages }, (_, page) => (
          <PdfPage key={page} pdf={pdf} page={page} paper {...props} />
        ))
      ) : (
        <div className="paper-pdf-loading">Loading document…</div>
      )}
    </div>
  );
}

function PdfPage({
  pdf,
  page,
  fields = [],
  onChange,
  name = "",
  owner,
  selected,
  onSelect,
  onSignHere,
  paper = false,
}: FieldsProps & { pdf: PDFDocumentProxy; page: number; paper?: boolean }) {
  const [pdfPage, setPdfPage] = useState<PDFPageProxy>();
  const [error, setError] = useState("");
  const [near, setNear] = useState(!paper);
  const [width, setWidth] = useState(700);
  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    void pdf
      .getPage(page + 1)
      .then((p) => {
        if (active) setPdfPage(p);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [pdf, page]);
  useEffect(() => {
    const node = wrapper.current;
    if (!node) return;
    const size = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    size.observe(node);
    const intersection = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { rootMargin: "1000px" },
    );
    if (paper) intersection.observe(node);
    return () => {
      size.disconnect();
      intersection.disconnect();
    };
  }, [paper]);
  useEffect(() => {
    if (!pdfPage || !canvas.current || !near || !width) return;
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
  }, [pdfPage, width, near]);
  const view = pdfPage?.getViewport({ scale: 1 });
  return (
    <div
      ref={wrapper}
      data-pdf-page={page}
      className={cn(
        "relative mx-auto w-full bg-white",
        paper
          ? "paper-pdf-page"
          : "max-w-[850px] shadow-sm ring-1 ring-black/10",
      )}
      style={{ aspectRatio: view ? `${view.width}/${view.height}` : "612/792" }}
    >
      <canvas
        ref={canvas}
        className="block h-full w-full"
        aria-label={`Document page ${page + 1}`}
      />
      {error && (
        <p role="alert" className="absolute top-0 bg-white p-4 text-red-700">
          {error}
        </p>
      )}
      {fields
        .filter((f) => f.page === page)
        .map((f) => (
          <FieldOverlay
            key={f.id}
            field={f}
            pageWidth={view?.width ?? 612}
            pageHeight={view?.height ?? 792}
            displayScale={Math.min(1, width / (((view?.width ?? 612) * 4) / 3))}
            name={name}
            owner={owner}
            selected={selected === f.id}
            onSelect={() => onSelect?.(f.id)}
            onSignHere={onSignHere}
            onChange={
              onChange
                ? (update) =>
                    onChange(
                      fields.map((item) => (item.id === f.id ? update : item)),
                    )
                : undefined
            }
          />
        ))}
    </div>
  );
}

function FieldOverlay({
  field: f,
  pageWidth,
  pageHeight,
  displayScale,
  name,
  owner,
  selected,
  onSelect,
  onChange,
  onSignHere,
}: {
  field: SignatureField;
  pageWidth: number;
  pageHeight: number;
  displayScale: number;
  name: string;
  owner?: OwnerSignature;
  selected: boolean;
  onSelect: () => void;
  onChange?: (field: SignatureField) => void;
  onSignHere?: () => void;
}) {
  const drag = useRef<
    | {
        x: number;
        y: number;
        original: SignatureField;
        mode: "move" | "resize";
      }
    | undefined
  >(undefined);
  const kind = fieldKind(f);
  const date = isDateField(f);
  const own = isOwnerField(f);
  const text = own
    ? owner
      ? date
        ? signingDate(owner.signedAt)
        : owner.name
      : ""
    : date
      ? ""
      : name;
  const label = FIELD_LABELS[kind];
  const w = f.width * pageWidth,
    h = f.height * pageHeight;
  const [layout, setLayout] = useState<{
    size: number;
    x: number;
    baseline: number;
  }>();
  useEffect(() => {
    let active = true;
    setLayout(undefined);
    if (text)
      void import("@/lib/pdf")
        .then((m) =>
          m.fieldTextLayout(text, w, f.kind === undefined ? h * 0.75 : h, date),
        )
        .then((value) => {
          if (active) setLayout(value);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [text, w, h, date, f.kind]);
  const customerTag = !onChange && !!onSignHere && kind === "customerSignature";
  return (
    <div
      data-field-id={f.id}
      data-customer-signature={
        kind === "customerSignature" ? "true" : undefined
      }
      role={onChange ? "button" : undefined}
      tabIndex={onChange ? 0 : undefined}
      aria-label={onChange ? `${label}, drag to move` : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (
          !onChange ||
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
        )
          return;
        e.preventDefault();
        const dx =
          e.key === "ArrowLeft" ? -0.005 : e.key === "ArrowRight" ? 0.005 : 0;
        const dy =
          e.key === "ArrowUp" ? -0.005 : e.key === "ArrowDown" ? 0.005 : 0;
        if (e.shiftKey) onChange(resizeField(f, f.width + dx, f.height + dy));
        else
          onChange({
            ...f,
            x: Math.max(0, Math.min(1 - f.width, f.x + dx)),
            y: Math.max(0, Math.min(1 - f.height, f.y + dy)),
          });
      }}
      onPointerDown={(e) => {
        if (!onChange) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          original: f,
          mode: (e.target as HTMLElement).closest("[data-resize]")
            ? "resize"
            : "move",
        };
        onSelect();
      }}
      onPointerMove={(e) => {
        if (!onChange || !drag.current) return;
        const parent = e.currentTarget.parentElement!.getBoundingClientRect();
        const { x, y, original, mode } = drag.current;
        const dx = (e.clientX - x) / parent.width,
          dy = (e.clientY - y) / parent.height;
        onChange(
          mode === "resize"
            ? resizeField(original, original.width + dx, original.height + dy)
            : {
                ...original,
                x: Math.max(0, Math.min(1 - original.width, original.x + dx)),
                y: Math.max(0, Math.min(1 - original.height, original.y + dy)),
              },
        );
      }}
      onPointerUp={() => {
        drag.current = undefined;
      }}
      onPointerCancel={() => {
        drag.current = undefined;
      }}
      className={cn(
        "absolute",
        onChange &&
          "touch-none cursor-grab outline outline-1 outline-dashed outline-amber-600 bg-amber-100/40 active:cursor-grabbing",
        onChange && own && "outline-blue-600 bg-blue-100/40",
        selected && onChange && "ring-2 ring-primary",
      )}
      style={{
        left: `${f.x * 100}%`,
        top: `${f.y * 100}%`,
        width: `${f.width * 100}%`,
        height: `${f.height * 100}%`,
      }}
    >
      {text && layout ? (
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="pointer-events-none block h-full w-full overflow-hidden"
          aria-label={text}
        >
          <text
            x={layout.x}
            y={layout.baseline}
            fontSize={layout.size}
            fill={date ? "#000" : "#1a1f7a"}
            opacity={!own && !onChange ? 0.4 : 1}
            style={{
              fontFamily: date
                ? "Arial, Helvetica, sans-serif"
                : '"Homemade Apple", cursive',
            }}
          >
            {text}
          </text>
        </svg>
      ) : onChange ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden px-1 text-center text-[10px] leading-tight">
          {label}
        </span>
      ) : null}
      {customerTag && (
        <span
          className="absolute"
          style={{
            left: -58 * displayScale,
            bottom: 4 * displayScale,
            transform: `scale(${displayScale})`,
            transformOrigin: "left bottom",
          }}
        >
          <button
            type="button"
            className="pd-sign-here"
            style={{ position: "relative", left: 0, bottom: 0 }}
            onClick={onSignHere}
          >
            Sign here
          </button>
        </span>
      )}
      {onChange && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute border-t border-dotted border-current opacity-40"
          style={{
            left: `${(4 / w) * 100}%`,
            right: `${(4 / w) * 100}%`,
            bottom: `${((f.kind === undefined ? h * 0.25 + 2 : 2) / h) * 100}%`,
          }}
        />
      )}
      {onChange && (
        <span
          data-resize
          aria-hidden="true"
          className="absolute -right-1.5 -bottom-1.5 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-amber-600 shadow"
        />
      )}
    </div>
  );
}
