"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PdfViewer } from "./pdf-viewer";
import { Status } from "./dashboard";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent } from "./ui/card";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";
import {
  ArrowLeft,
  Plus,
  Copy,
  Download,
  Trash2,
  Check,
  LockKeyhole,
  ExternalLink,
} from "lucide-react";
import { getPdf, downloadPdf } from "@/lib/files";
import { dateTime, errorMessage } from "@/lib/utils";
import type { SignatureField } from "@/lib/signing";
export function DocumentEditor({ id }: { id: Id<"documents"> }) {
  const doc = useQuery(api.documents.get, { id });
  const save = useMutation(api.documents.saveFields);
  const issue = useMutation(api.documents.issue);
  const withdraw = useMutation(api.documents.withdraw);
  const { getToken } = useAuth();
  const [bytes, setBytes] = useState<Uint8Array>();
  const [page, setPage] = useState(0);
  const [fields, setFields] = useState<SignatureField[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!doc) return;
    let active = true;
    setBytes(undefined);
    void getToken({ template: "convex" })
      .then((jwt) => getPdf(id, { jwt, signed: doc.status === "signed" }))
      .then((data) => {
        if (active) setBytes(data);
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [id, doc?.status === "signed", getToken, !!doc]);
  const current = fields ?? doc?.fields ?? [];
  const field = current.find((f) => f.id === selected);
  const draft = doc?.status === "draft";
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const link = doc?.token
    ? `${typeof window !== "undefined" ? window.location.origin : "https://staff.expandhandyman.com"}/sign/${doc.token}`
    : "";
  if (doc === undefined)
    return (
      <p className="p-10 text-sm text-muted-foreground">Loading document…</p>
    );
  if (!doc) return <p className="p-10">Document not found.</p>;
  return (
    <main>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-5 md:px-8">
        <div>
          <Link
            href="/"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground"
          >
            <ArrowLeft size={13} />
            Documents
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">{doc.title}</h1>
            <Status status={doc.status} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {doc.customer?.name} · {doc.customer?.site}
          </p>
        </div>
        <div className="flex gap-2">
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
            Download {doc.status === "signed" ? "signed PDF" : "PDF"}
          </Button>
          {draft && (
            <Button
              disabled={busy || current.length === 0 || !bytes}
              onClick={() =>
                act(async () => {
                  await save({ id, fields: current });
                  const token = Array.from(
                    crypto.getRandomValues(new Uint8Array(32)),
                    (b) => b.toString(16).padStart(2, "0"),
                  ).join("");
                  await issue({ id, token });
                  setFields(null);
                  setNotice("Your customer link is ready. Copy it below.");
                })
              }
            >
              Create signing link
            </Button>
          )}
        </div>
      </header>
      <div className="grid items-start lg:grid-cols-[1fr_300px]">
        <section className="min-w-0 bg-muted/50 p-4 md:p-7">
          {bytes ? (
            <PdfViewer
              bytes={bytes}
              page={page}
              onPageChange={setPage}
              fields={doc.status === "signed" ? [] : current}
              onChange={draft ? setFields : undefined}
              selected={selected}
              onSelect={setSelected}
            />
          ) : (
            <div className="min-h-[500px] p-10 text-center text-sm text-muted-foreground">
              {error || "Loading PDF…"}
            </div>
          )}
        </section>
        <aside className="space-y-6 p-5 lg:sticky lg:top-0">
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="rounded-lg bg-primary/10 p-3 text-sm">
              {notice}
            </p>
          )}
          {draft ? (
            <>
              <div>
                <h2 className="text-sm font-semibold">Signature placement</h2>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Add a field to this page, then drag it onto the signature
                  line. Arrow keys move a selected field precisely.
                </p>
                <Button
                  className="mt-4 w-full"
                  variant="outline"
                  disabled={!bytes || busy}
                  onClick={() => {
                    const f = {
                      id: crypto.randomUUID(),
                      page,
                      x: 0.1,
                      y: 0.7,
                      width: 0.32,
                      height: 0.075,
                    };
                    setFields([...current, f]);
                    setSelected(f.id);
                  }}
                >
                  <Plus />
                  Add signature field
                </Button>
              </div>
              {current.length > 0 && (
                <div className="space-y-2">
                  {current.map((f, i) => (
                    <Button
                      key={f.id}
                      variant={selected === f.id ? "secondary" : "ghost"}
                      className="w-full justify-start"
                      onClick={() => {
                        setSelected(f.id);
                        setPage(f.page);
                      }}
                    >
                      Signature {i + 1}
                      <span className="ml-auto text-xs text-muted-foreground">
                        Page {f.page + 1}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
              {field && (
                <div className="space-y-3 border-t pt-4">
                  <Label htmlFor="field-width">Field width (%)</Label>
                  <Input
                    id="field-width"
                    type="number"
                    min={10}
                    max={Math.floor((1 - field.x) * 100)}
                    value={Math.round(field.width * 100)}
                    onChange={(e) => {
                      const width = Math.max(
                        0.1,
                        Math.min(1 - field.x, Number(e.target.value) / 100),
                      );
                      setFields(
                        current.map((f) =>
                          f.id === field.id ? { ...f, width } : f,
                        ),
                      );
                    }}
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setFields(current.filter((f) => f.id !== selected));
                      setSelected("");
                    }}
                  >
                    <Trash2 />
                    Remove field
                  </Button>
                </div>
              )}
              <Button
                className="w-full"
                variant="secondary"
                disabled={busy || fields === null}
                onClick={() =>
                  act(async () => {
                    await save({ id, fields: current });
                    setFields(null);
                    setNotice("Placement saved.");
                  })
                }
              >
                Save placement
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <LockKeyhole size={15} className="shrink-0" />
                <p>
                  {doc.status === "signed"
                    ? "This signed document is locked. Upload a new copy to make changes."
                    : "The PDF and signature fields are locked while this link is active."}
                </p>
              </div>
              <div>
                <Label htmlFor="sign-link">Customer link</Label>
                <Input
                  id="sign-link"
                  className="mt-2 text-xs"
                  readOnly
                  value={link}
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() =>
                      act(async () => {
                        await navigator.clipboard.writeText(link);
                        setNotice("Link copied. Send it to your customer.");
                      })
                    }
                  >
                    <Copy />
                    Copy link
                  </Button>
                  <Button
                    variant="outline"
                    aria-label="Open customer preview"
                    render={<a href={link} target="_blank" rel="noreferrer" />}
                  >
                    <ExternalLink />
                  </Button>
                </div>
              </div>
              {doc.status !== "signed" && (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={() => setConfirm(true)}
                >
                  Withdraw link & edit
                </Button>
              )}
            </>
          )}
          <Card className="shadow-none">
            <CardContent className="space-y-4 p-4">
              <h2 className="text-sm font-semibold">Activity</h2>
              {[
                ["Uploaded", doc._creationTime],
                ["Link created", doc.issuedAt],
                ["First viewed", doc.viewedAt],
                ["Signed", doc.signedAt],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex gap-2">
                  <Check
                    size={14}
                    className={
                      value ? "mt-0.5 text-primary" : "mt-0.5 text-border"
                    }
                  />
                  <div>
                    <p className="text-xs font-medium">{label}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {dateTime(value as number | undefined)}
                    </p>
                  </div>
                </div>
              ))}
              {doc.signerName && (
                <div className="border-t pt-3">
                  <p className="text-xs text-muted-foreground">Signed by</p>
                  <p className="signature-ink mt-1 text-3xl">
                    {doc.signerName}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw this signing link?</AlertDialogTitle>
            <AlertDialogDescription>
              The current customer link will stop working. You can edit the
              fields and create a new link afterward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep link</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                act(async () => {
                  await withdraw({ id });
                  setFields(null);
                  setNotice(
                    "Previous link withdrawn. You can edit the placement.",
                  );
                })
              }
            >
              Withdraw link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
