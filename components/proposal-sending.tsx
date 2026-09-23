"use client";

import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { RotateCcw, Send, Undo2 } from "lucide-react";
import { useState } from "react";

import { CopyLinkButton, useAppOrigin } from "@/components/copy-link";
import { OpenedChip } from "@/components/proposal-chips";
import { FieldHeading } from "@/components/side-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { sendBlockerMessage } from "@/lib/proposal-pricing";
import {
  emailFailed,
  endedReasonLabel,
  linkEmailLabel,
  signingPath,
} from "@/lib/signing-link";
import { cn, dateTime, errorMessage } from "@/lib/utils";

type ProposalsTab = FunctionReturnType<typeof api.proposals.forCustomer>;
type Proposal = ProposalsTab["proposals"][number];

// The panel's Send, and once sent, its signing link: where it went, whether
// the email did, whether the customer has opened it, and the two ways to act
// on an offer still waiting — Re-send and Withdraw. A refusal is said here,
// beside the button that met it.
export function ProposalSending({
  proposal,
  customerEmail,
}: {
  proposal: Proposal;
  customerEmail: string | null;
}) {
  const [refusal, setRefusal] = useState("");
  const attempt = async (act: () => Promise<unknown>) => {
    try {
      await act();
      setRefusal("");
    } catch (err) {
      setRefusal(errorMessage(err));
    }
  };

  return (
    <div className="space-y-2">
      <FieldHeading>{proposal.state === "draft" ? "Send" : "Signing link"}</FieldHeading>
      {refusal ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {refusal}
        </p>
      ) : null}
      {proposal.state === "draft" ? (
        <SendDraft proposal={proposal} customerEmail={customerEmail} attempt={attempt} />
      ) : (
        <SentLink proposal={proposal} customerEmail={customerEmail} attempt={attempt} />
      )}
      {proposal.links.length > 0 ? <LinkHistory links={proposal.links} /> : null}
    </div>
  );
}

type Attempt = (act: () => Promise<unknown>) => Promise<void>;

function SendDraft({
  proposal,
  customerEmail,
  attempt,
}: {
  proposal: Proposal;
  customerEmail: string | null;
  attempt: Attempt;
}) {
  const send = useAction(api.proposals.send);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const blocked = proposal.sendBlockers.length > 0;

  return (
    <>
      {blocked ? (
        <ul className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {proposal.sendBlockers.map((blocker) => (
            <li key={blocker}>{sendBlockerMessage(blocker)}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">
          Emails {customerEmail} a private link to read and approve it. From then on, edits to
          its solutions, the customer or the site no longer change it.
        </p>
      )}
      <Button disabled={blocked || sending} onClick={() => setConfirming(true)}>
        <Send data-icon="inline-start" aria-hidden /> {sending ? "Sending…" : "Send proposal"}
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send {proposal.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              {customerEmail} gets an email with a private link to read and approve it. The
              offer is fixed as it stands now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep drafting</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirming(false);
                setSending(true);
                await attempt(() => send({ proposalId: proposal.proposalId }));
                setSending(false);
              }}
            >
              Send proposal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// The live link, for an offer the customer has yet to answer, and what became
// of its email. The link is always shown to copy, and said out loud when the
// email did not go, because then the owner is the only way it reaches them.
function SentLink({
  proposal,
  customerEmail,
  attempt,
}: {
  proposal: Proposal;
  customerEmail: string | null;
  attempt: Attempt;
}) {
  const resend = useAction(api.proposals.resend);
  const withdraw = useMutation(api.proposals.withdraw);
  const origin = useAppOrigin();
  const [confirming, setConfirming] = useState<"resend" | "withdraw" | null>(null);
  const [busy, setBusy] = useState(false);
  const live = proposal.links.find((link) => link.endedAt === null) ?? null;
  const url =
    proposal.liveUrl ??
    (proposal.liveToken && origin ? `${origin}${signingPath(proposal.liveToken)}` : "");

  const act = async (run: () => Promise<unknown>) => {
    setConfirming(null);
    setBusy(true);
    await attempt(run);
    setBusy(false);
  };

  if (proposal.state !== "sent" || !live) return null;

  return (
    <>
      <div className="space-y-2 rounded-xl border px-3 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {proposal.opened ? (
            <OpenedChip />
          ) : (
            <span className="text-xs text-slate-500">Not opened yet</span>
          )}
          <span
            className={cn(
              "text-xs",
              emailFailed(live.email) ? "font-medium text-amber-800" : "text-slate-500",
            )}
          >
            {linkEmailLabel(live.email)}
          </span>
        </div>
        {emailFailed(live.email) ? (
          <p className="text-sm text-amber-900">
            The link works: copy it and send it to {live.sentTo} yourself.
          </p>
        ) : null}
        {url ? (
          <>
            <p className="break-all rounded-md bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700 select-all">
              {url}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <CopyLinkButton url={url} />
            </div>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || customerEmail === null}
          onClick={() => setConfirming("resend")}
        >
          <RotateCcw data-icon="inline-start" aria-hidden /> Re-send
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => setConfirming("withdraw")}>
          <Undo2 data-icon="inline-start" aria-hidden /> Withdraw
        </Button>
      </div>
      {customerEmail === null ? (
        <p className="text-xs text-slate-500">
          The customer has no email address now. Add one to re-send.
        </p>
      ) : null}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          {confirming === "withdraw" ? (
            <AlertDialogHeader>
              <AlertDialogTitle>Withdraw {proposal.code}?</AlertDialogTitle>
              <AlertDialogDescription>
                Its link stops working and it goes back to Draft, reading its solutions as
                they are now. The customer isn&rsquo;t told.
              </AlertDialogDescription>
            </AlertDialogHeader>
          ) : (
            <AlertDialogHeader>
              <AlertDialogTitle>Re-send {proposal.code}?</AlertDialogTitle>
              <AlertDialogDescription>
                {customerEmail} gets the same offer with a fresh link. The link sent to{" "}
                {live.sentTo} stops working.
              </AlertDialogDescription>
            </AlertDialogHeader>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void act(() =>
                  confirming === "withdraw"
                    ? withdraw({ proposalId: proposal.proposalId })
                    : resend({ proposalId: proposal.proposalId }),
                )
              }
            >
              {confirming === "withdraw" ? "Withdraw" : "Re-send"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Every link the proposal has had, newest first: where it went and when,
// whether its email did, and why it ended.
function LinkHistory({ links }: { links: Proposal["links"] }) {
  return (
    <details className="group text-sm" open={links.length > 1 || undefined}>
      <summary className="cursor-pointer text-xs font-medium text-slate-500">
        Link history ({links.length})
      </summary>
      <ol className="mt-2 divide-y overflow-hidden rounded-xl border">
        {links.map((link) => (
          <li key={link.linkId} className="space-y-0.5 px-3 py-2">
            <div className="flex flex-wrap justify-between gap-x-3">
              <span className="min-w-0 truncate text-slate-900">{link.sentTo}</span>
              <span className="shrink-0 text-xs text-slate-500 tabular-nums">
                {dateTime(link.sentAt)}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 text-xs text-slate-500">
              <span className={cn(emailFailed(link.email) && "text-amber-800")}>
                {linkEmailLabel(link.email)}
              </span>
              <span>
                {link.endedReason ? endedReasonLabel(link.endedReason) : "Live"}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
