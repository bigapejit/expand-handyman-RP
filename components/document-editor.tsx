"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PdfViewer } from "./pdf-viewer";
import { DocumentStatusChip } from "./document-chips";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { Badge } from "./ui/badge";
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
  Eye,
  LockKeyhole,
  ExternalLink,
} from "lucide-react";
import { getPdf, downloadPdf } from "@/lib/files";
import { dateTime, duration, errorMessage } from "@/lib/utils";
import {
  FIELD_LABELS,
  fieldKind,
  isOwnerField,
  resizeField,
  signerName,
  type FieldKind,
  type SignatureField,
} from "@/lib/signing";
export function DocumentEditor({ id }: { id: Id<"documents"> }) {
  const doc = useQuery(api.documents.get, { id });
  const views = useQuery(api.documents.views, { id });
  const save = useMutation(api.documents.saveFields);
  const issue = useMutation(api.documents.issue);
  const withdraw = useMutation(api.documents.withdraw);
  const applySignature = useMutation(api.documents.applyOwnerSignature);
  const { getToken } = useAuth();
  const [bytes, setBytes] = useState<Uint8Array>();
  const [page, setPage] = useState(0);
  const [fields, setFields] = useState<SignatureField[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [ownerConsent, setOwnerConsent] = useState(false);
  const [allViews, setAllViews] = useState(false);
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
  function addField(kind: FieldKind) {
    const f: SignatureField = {
      id: crypto.randomUUID(),
      kind,
      page,
      x: 0.1,
      y: 0.65,
      width: kind.endsWith("Date") ? 0.2 : 0.32,
      height: kind.endsWith("Date") ? 0.035 : 0.075,
    };
    setFields([...current, f]);
    setSelected(f.id);
  }
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
    // Full page: bleeds past the shell's content padding, as before the shell.
    <div className="-m-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-5 md:px-8">
        <div>
          <Link
            href="/documents"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground"
          >
            <ArrowLeft size={13} />
            Documents
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">{doc.title}</h1>
            <DocumentStatusChip status={doc.status} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {doc.customerName} · {doc.site}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!bytes || busy}
            onClick={() =>
              act(async () => {
                if (!bytes) return;
                const data =
                  doc.status === "signed"
                    ? bytes
                    : await (
                        await import("@/lib/pdf")
                      ).ownerPdf(bytes, current, doc.ownerSignature);
                downloadPdf(
                  data,
                  `${doc.title}${doc.status === "signed" ? " - signed" : ""}`,
                );
              })
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
                  if (
                    current.some(isOwnerField) &&
                    ownerName !== null &&
                    ownerName.trim() !== doc.ownerSignature?.name
                  )
                    throw new Error(
                      "Apply your updated signature before creating the customer link.",
                    );
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
              owner={doc.ownerSignature}
              name={doc.customerName}
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
                <h2 className="text-sm font-semibold">
                  Signature & date placement
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Drag fields into place. Drag a corner to resize width and
                  height. Arrow keys move; Shift + arrows resize. Align the
                  bottom guide with the signature line. The customer name is
                  shown as a preview.
                </p>
                <div className="mt-4 grid gap-2">
                  {(Object.entries(FIELD_LABELS) as [FieldKind, string][]).map(
                    ([kind, label]) => (
                      <Button
                        key={kind}
                        variant="outline"
                        className="justify-start"
                        disabled={!bytes || busy}
                        onClick={() => addField(kind)}
                      >
                        <Plus />
                        {label}
                      </Button>
                    ),
                  )}
                </div>
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
                      {FIELD_LABELS[fieldKind(f)]} {i + 1}
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
                  <Label htmlFor="field-height">Field height (%)</Label>
                  <Input
                    id="field-height"
                    type="number"
                    min={2.5}
                    step={0.5}
                    max={Math.floor((1 - field.y) * 100)}
                    value={Math.round(field.height * 1000) / 10}
                    onChange={(e) =>
                      setFields(
                        current.map((f) =>
                          f.id === field.id
                            ? resizeField(
                                f,
                                f.width,
                                Number(e.target.value) / 100,
                              )
                            : f,
                        ),
                      )
                    }
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
              {current.some(isOwnerField) && (
                <div className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-semibold">Your signature</h3>
                  <Label htmlFor="owner-name">Your full name</Label>
                  <Input
                    id="owner-name"
                    autoComplete="name"
                    maxLength={100}
                    value={ownerName ?? doc.ownerSignature?.name ?? ""}
                    onChange={(e) => setOwnerName(e.target.value)}
                  />
                  {doc.ownerSignature && (
                    <p className="text-xs text-muted-foreground">
                      Applied by {doc.ownerSignature.name} ·{" "}
                      {dateTime(doc.ownerSignature.signedAt)}
                    </p>
                  )}
                  <label className="flex items-start gap-2 text-xs leading-relaxed">
                    <Checkbox
                      checked={ownerConsent}
                      onCheckedChange={(value) =>
                        setOwnerConsent(value === true)
                      }
                    />
                    I am applying my own electronic signature to this document.
                  </label>
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={busy || !bytes || !ownerConsent}
                    onClick={() =>
                      act(async () => {
                        if (!bytes) return;
                        const name = signerName(
                          ownerName ?? doc.ownerSignature?.name ?? "",
                        );
                        await (
                          await import("@/lib/pdf")
                        ).ownerPdf(bytes, current, { name, signedAt: 0 });
                        await save({ id, fields: current });
                        await applySignature({
                          id,
                          name,
                          consent: ownerConsent,
                        });
                        setFields(null);
                        setOwnerConsent(false);
                        setNotice(
                          "Your signature is applied. Its date will use this signing time.",
                        );
                      })
                    }
                  >
                    Apply my signature
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
                ["Signed", doc.signedAt],
                ["Declined", doc.declinedAt],
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
              <div className="space-y-3 border-t pt-3">
                <h3 className="text-xs font-medium">Opens</h3>
                {views?.length === 0 &&
                  (doc.viewedAt ? (
                    <div className="flex gap-2">
                      <Eye
                        size={14}
                        className="mt-0.5 shrink-0 text-muted-foreground"
                      />
                      <div>
                        <p className="text-[11px] font-medium">
                          {dateTime(doc.viewedAt)}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          First viewed, before opens were logged
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Not opened yet
                    </p>
                  ))}
                {(allViews ? views : views?.slice(0, 10))?.map((view) => (
                  <div key={view._id} className="flex gap-2">
                    <Eye
                      size={14}
                      className="mt-0.5 shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                        {dateTime(view.openedAt)}
                        {view.viewer === "owner" && (
                          <Badge
                            variant="secondary"
                            className="h-4 px-1.5 text-[10px] font-normal"
                          >
                            You
                          </Badge>
                        )}
                        {view.previousLink && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1.5 text-[10px] font-normal"
                          >
                            Previous link
                          </Badge>
                        )}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {duration(view.viewedMs)}
                        {view.documentStatus === "signed"
                          ? " · Opened signed copy"
                          : view.documentStatus === "declined"
                            ? " · Opened after declining"
                            : ""}
                      </p>
                    </div>
                  </div>
                ))}
                {(views?.length ?? 0) > 10 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAllViews(!allViews)}
                  >
                    {allViews ? "Show fewer" : `Show all ${views!.length}`}
                  </Button>
                )}
              </div>
              {doc.signerName && (
                <div className="border-t pt-3">
                  <p className="text-xs text-muted-foreground">Signed by</p>
                  <p className="signature-ink mt-1 text-3xl">
                    {doc.signerName}
                  </p>
                </div>
              )}
              {doc.ownerSignature && (
                <p className="text-xs text-muted-foreground">
                  Owner signed: {doc.ownerSignature.name} ·{" "}
                  {dateTime(doc.ownerSignature.signedAt)}
                </p>
              )}
              {doc.declineReason && (
                <p className="text-xs text-muted-foreground">
                  Decline reason: {doc.declineReason}
                </p>
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
    </div>
  );
}
