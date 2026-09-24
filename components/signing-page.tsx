"use client";
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PdfPages } from "./pdf-viewer";
import { SignBar, type SignBarOpen, type SignatureInput } from "./sign-bar";
import { LinkNotLive } from "./link-not-live";
import { useViewHeartbeat } from "./view-heartbeat";
import { getPdf, downloadPdf, uploadFile } from "@/lib/files";
import { signerName, signingDate } from "@/lib/signing";
import { errorMessage } from "@/lib/utils";

function scrollToSignature() {
  requestAnimationFrame(() => {
    const line = document.querySelector('[data-customer-signature="true"]');
    if (!line) return;
    const bar =
      document.querySelector(".paper-bar")?.getBoundingClientRect().height ?? 0;
    const header =
      document.querySelector(".paper-top")?.getBoundingClientRect().height ?? 0;
    const rect = line.getBoundingClientRect();
    window.scrollTo({
      top: Math.max(
        0,
        window.scrollY +
          rect.top +
          rect.height / 2 -
          header -
          (window.innerHeight - bar - header) / 2,
      ),
      behavior: "smooth",
    });
  });
}
export function SigningPage({ token }: { token: string }) {
  const doc = useQuery(api.documents.forSigner, { token });
  const opened = useMutation(api.documents.opened);
  const seen = useMutation(api.documents.seen);
  const begin = useMutation(api.documents.beginSigning);
  const finish = useAction(api.pdfActions.finish);
  const decline = useMutation(api.documents.decline);
  const [bytes, setBytes] = useState<Uint8Array>();
  const [open, setOpen] = useState<SignBarOpen>(null);
  const [pendingName, setPendingName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const [lockedInput, setLockedInput] = useState<SignatureInput>();
  const attempt = useRef<string | undefined>(undefined);
  const view = useRef<Id<"documentViews"> | null>(null);
  const logged = useRef(false);
  const [retry, setRetry] = useState(0);
  const signed = doc?.status === "signed";
  useEffect(() => {
    if (!doc) return;
    let active = true;
    setBytes(undefined);
    setFileError("");
    void getPdf(doc._id, { token, signed })
      .then((data) => {
        if (active) {
          setBytes(data);
          if (!logged.current) {
            logged.current = true;
            void opened({ token, userAgent: navigator.userAgent })
              .then((id) => {
                view.current = id;
              })
              .catch(() => {});
          }
        }
      })
      .catch((e) => {
        if (active) setFileError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [doc?._id, signed, token, opened, retry]);
  useViewHeartbeat(view, token, seen);

  if (doc === null) return <LinkNotLive what="document" />;
  const download = (primary = false) => (
    <button
      type="button"
      className={`paper-btn${primary ? " paper-btn-primary" : ""}`}
      disabled={!bytes || busy}
      onClick={async () => {
        if (!bytes || !doc) return;
        setBusy(true);
        setFileError("");
        try {
          const data = signed
            ? bytes
            : await (
                await import("@/lib/pdf")
              ).ownerPdf(bytes, doc.fields, doc.ownerSignature);
          downloadPdf(data, `${doc.title}${signed ? " - signed" : ""}`);
        } catch (e) {
          setFileError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {signed ? "Download signed copy" : "Download PDF"}
    </button>
  );
  return (
    <div className="paper-screen paper-screen-signing">
      <header className="paper-top">
        <div className="paper-top-row">
          {/* The FRSG header, with the supplied Expand mark. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="paper-brand" src="/logo.svg" alt="Expand Handyman" />
          <span className="paper-title">{doc?.title ?? ""}</span>
          {doc && download()}
        </div>
        {signed && (
          <div className="paper-strip paper-strip-signed" role="status">
            Signed by {doc.signerName} · {signingDate(doc.signedAt!)}. Your
            signed copy is ready.{" "}
            <button
              type="button"
              onClick={() =>
                document
                  .querySelector("[data-pdf-page]:last-child")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              See the certificate ›
            </button>
          </div>
        )}
        {doc?.status === "declined" && (
          <div className="paper-strip paper-strip-declined" role="status">
            Declined on {signingDate(doc.declinedAt!)}.
            {doc.declineReason ? ` Reason: ${doc.declineReason}` : ""}
          </div>
        )}
        {fileError && (
          <div className="paper-strip paper-strip-fault" role="alert">
            {fileError}{" "}
            <button type="button" onClick={() => setRetry(retry + 1)}>
              Try again
            </button>
          </div>
        )}
      </header>
      <main className="paper-sheets">
        {bytes && doc ? (
          <PdfPages
            bytes={bytes}
            fields={signed ? [] : doc.fields}
            owner={doc.ownerSignature}
            name={pendingName}
            onSignHere={
              doc.status !== "declined" && !signed
                ? () => {
                    setError("");
                    setOpen("sign");
                    scrollToSignature();
                  }
                : undefined
            }
          />
        ) : (
          <div className="paper-pdf-loading">Loading document…</div>
        )}
      </main>
      {doc && (
        <SignBar
          document={doc}
          open={open}
          busy={busy || !bytes}
          error={error}
          download={download(true)}
          lockedInput={lockedInput}
          onOpen={(which) => {
            setError("");
            setOpen(which);
            if (which === "sign") scrollToSignature();
          }}
          onPendingName={setPendingName}
          onApprove={async (input) => {
            if (!bytes || busy) return;
            setBusy(true);
            setError("");
            try {
              const name = signerName(input.name);
              const { completePdf } = await import("@/lib/pdf");
              await completePdf(
                bytes,
                doc.fields,
                {
                  name,
                  title: input.title.trim(),
                  signedAt: 0,
                  documentId: doc._id,
                  originalHash: doc.originalHash,
                },
                doc.ownerSignature,
              );
              const attemptId = attempt.current ?? crypto.randomUUID();
              const intent = await begin({
                token,
                name,
                title: input.title,
                consent: input.consent,
                attemptId,
              });
              attempt.current = attemptId;
              setLockedInput({ ...input, name });
              const completed = await completePdf(
                bytes,
                doc.fields,
                {
                  name: intent.name,
                  title: intent.title,
                  signedAt: intent.signedAt,
                  documentId: doc._id,
                  originalHash: doc.originalHash,
                },
                doc.ownerSignature,
              );
              const storageId = await uploadFile(
                intent.uploadUrl,
                new Blob([new Uint8Array(completed)], {
                  type: "application/pdf",
                }),
                "application/pdf",
              );
              await finish({
                token,
                attemptId,
                storageId: storageId as Id<"_storage">,
                userAgent: navigator.userAgent,
              });
              setOpen(null);
              scrollToSignature();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
          onDecline={async (reason) => {
            setBusy(true);
            setError("");
            try {
              await decline({ token, reason });
              setOpen(null);
              window.scrollTo({ top: 0, behavior: "smooth" });
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}
