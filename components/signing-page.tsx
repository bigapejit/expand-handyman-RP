"use client";
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Brand } from "./brand";
import { PdfViewer } from "./pdf-viewer";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { Download, CheckCircle2, FileX2 } from "lucide-react";
import { getPdf, downloadPdf, uploadFile } from "@/lib/files";
import { CONSENT, signerName } from "@/lib/signing";
import { dateTime, errorMessage } from "@/lib/utils";
export function SigningPage({ token }: { token: string }) {
  const doc = useQuery(api.documents.forSigner, { token });
  const opened = useMutation(api.documents.opened);
  const begin = useMutation(api.documents.beginSigning);
  const finish = useAction(api.pdfActions.finish);
  const [bytes, setBytes] = useState<Uint8Array>();
  const [page, setPage] = useState(0);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const attempt = useRef<string | undefined>(undefined);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!doc) return;
    let active = true;
    setBytes(undefined);
    setError("");
    void getPdf(doc._id, { token, signed: doc.status === "signed" })
      .then((data) => {
        if (active) {
          setBytes(data);
          void opened({ token }).catch(() => {
            /* Signing remains available if tracking fails. */
          });
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [doc?._id, doc?.status === "signed", token, opened, retry]);
  if (doc === undefined)
    return (
      <main className="grid min-h-dvh place-content-center">
        <Brand />
        <p className="mt-6 text-sm text-muted-foreground">
          Loading your document…
        </p>
      </main>
    );
  if (!doc)
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <Brand />
        <FileX2 className="mt-12 size-9 text-muted-foreground" />
        <h1 className="mt-5 text-2xl font-semibold">
          This link is unavailable
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Please contact Expand Handyman for a current signing link.
        </p>
      </main>
    );
  return (
    <div className="min-h-dvh bg-muted/50">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <Brand />
          <Button
            variant="outline"
            disabled={!bytes || busy}
            onClick={() =>
              bytes &&
              downloadPdf(
                bytes,
                `${doc.title}${doc.status === "signed" ? " - signed" : ""}`,
              )
            }
          >
            <Download />
            Download PDF
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        <div className="mb-6">
          <p className="text-xs text-muted-foreground">
            Prepared for {doc.customerName}
          </p>
          <h1 className="mt-2 text-xl font-semibold">{doc.title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{doc.site}</p>
        </div>
        {doc.status === "signed" && (
          <div
            role="status"
            className="mb-6 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
          >
            <CheckCircle2 className="shrink-0" />
            <div>
              <p className="text-sm font-semibold">
                Signed and saved. Thank you!
              </p>
              <p className="mt-1 text-xs">
                {doc.signerName} · {dateTime(doc.signedAt)}. You can return to
                this link to download your copy.
              </p>
            </div>
          </div>
        )}
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_310px]">
          <section className="min-w-0">
            {bytes ? (
              <PdfViewer
                bytes={bytes}
                fields={doc.status === "signed" ? [] : doc.fields}
                page={page}
                onPageChange={setPage}
                name={name}
              />
            ) : (
              <div className="min-h-80 rounded-lg border bg-background p-8 text-center text-sm text-muted-foreground">
                {error ? (
                  <>
                    <p role="alert">{error}</p>
                    <Button
                      className="mt-4"
                      variant="outline"
                      onClick={() => setRetry(retry + 1)}
                    >
                      Retry loading
                    </Button>
                  </>
                ) : (
                  "Loading PDF…"
                )}
              </div>
            )}
          </section>
          {doc.status !== "signed" && (
            <form
              className="space-y-4 rounded-xl border bg-background p-5 lg:sticky lg:top-5"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!bytes) return;
                setBusy(true);
                setError("");
                try {
                  setProgress("Preparing your signed PDF…");
                  const normalizedName = signerName(name);
                  const { completePdf } = await import("@/lib/pdf");
                  // Validate the font and PDF before reserving a signing attempt.
                  // A rejected name remains editable, and no server intent is stranded.
                  await completePdf(bytes, doc.fields, {
                    name: normalizedName,
                    signedAt: 0,
                    documentId: doc._id,
                    originalHash: doc.originalHash,
                  });
                  const attemptId = attempt.current ?? crypto.randomUUID();
                  const intent = await begin({
                    token,
                    name: normalizedName,
                    consent,
                    attemptId,
                  });
                  attempt.current = attemptId;
                  const completed = await completePdf(bytes, doc.fields, {
                    name: intent.name,
                    signedAt: intent.signedAt,
                    documentId: doc._id,
                    originalHash: doc.originalHash,
                  });
                  setProgress("Saving your signed copy…");
                  const storageId = await uploadFile(
                    intent.uploadUrl,
                    new Blob([new Uint8Array(completed)], {
                      type: "application/pdf",
                    }),
                  );
                  await finish({
                    token,
                    attemptId: attempt.current,
                    storageId: storageId as Id<"_storage">,
                    userAgent: navigator.userAgent,
                  });
                  setPage(0);
                } catch (err) {
                  setError(errorMessage(err));
                } finally {
                  setBusy(false);
                  setProgress("");
                }
              }}
            >
              <h2 className="font-semibold">Review & sign</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Review all {doc.pageCount}{" "}
                {doc.pageCount === 1 ? "page" : "pages"}, then enter your full
                name. Your signature will appear in{" "}
                {doc.fields.length === 1
                  ? "the highlighted field"
                  : `all ${doc.fields.length} highlighted fields`}
                .
              </p>
              <div className="flex flex-wrap gap-1">
                {[...new Set(doc.fields.map((f) => f.page))].map((p) => (
                  <Button
                    key={p}
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage(p)}
                  >
                    Signature · page {p + 1}
                  </Button>
                ))}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="signer-name">Full name</Label>
                <Input
                  id="signer-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  disabled={busy || !!attempt.current}
                  placeholder="Your full name"
                />
              </div>
              <div className="rounded-lg border bg-muted/30 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Your signature
                </p>
                <p className="signature-ink mt-1 min-h-12 break-words text-4xl">
                  {name || "Your name"}
                </p>
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="consent"
                  checked={consent}
                  onCheckedChange={(value) => setConsent(value === true)}
                  disabled={busy}
                />
                <Label
                  htmlFor="consent"
                  className="block text-xs font-normal leading-relaxed"
                >
                  {CONSENT}
                </Label>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                className="w-full"
                size="lg"
                type="submit"
                disabled={busy || !bytes || !consent || name.trim().length < 2}
              >
                {busy ? progress : "Sign & save document"}
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                A signed copy will be available to download.
              </p>
            </form>
          )}
        </div>
      </main>
      <footer className="px-5 py-8 text-center text-[11px] text-muted-foreground">
        Expand Handyman · Customer documents
      </footer>
    </div>
  );
}
