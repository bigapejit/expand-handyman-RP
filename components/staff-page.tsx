"use client";

import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { LoaderCircle, Mail, MoreHorizontal, Send, Trash2, UserPlus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Monogram } from "@/components/monogram";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/convex/_generated/api";
import { useNow } from "@/hooks/use-now";
import { timeAgo } from "@/lib/thumbtack";
import { errorMessage } from "@/lib/utils";

const dayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
});

type StaffMember = FunctionReturnType<typeof api.staff.list>[number];
type Outcome = { tone: "done" | "fault"; text: string };

// The Staff page (CONTEXT.md, **Staff member**): who has access, and the
// invites still waiting to be taken up. The Owner's pinned accounts carry an
// Owner pill instead of a menu, since nobody can remove them; your own row has
// no menu either, since removing yourself would delete the account you're on.
export function StaffPage({ header }: { header: ReactNode }) {
  const members = useQuery(api.staff.list);
  const resend = useAction(api.staff.resend);
  const remove = useAction(api.staff.remove);
  const now = useNow();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const act = async (run: () => Promise<string>) => {
    setBusy(true);
    try {
      setOutcome({ tone: "done", text: await run() });
    } catch (err) {
      setOutcome({ tone: "fault", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const active = members?.filter((m) => m.status === "active") ?? [];
  const invited = members?.filter((m) => m.status === "invited") ?? [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        {header}
        <Button size="lg" onClick={() => setInviting(true)}>
          <UserPlus data-icon="inline-start" aria-hidden />
          Invite someone
        </Button>
      </div>
      {outcome ? <Notice outcome={outcome} /> : null}

      {members === undefined ? (
        <div className="grid min-h-64 place-items-center rounded-2xl border bg-white">
          <LoaderCircle aria-label="Loading staff" className="size-6 animate-spin text-slate-500" />
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Has access <span className="font-normal text-slate-500">· {active.length}</span>
            </h2>
            <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
              {active.map((m) => (
                <li key={m._id} className="flex items-center gap-4 px-4 py-3">
                  <Monogram name={m.name ?? m.email} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">
                      {m.name ?? m.email}
                      {m.you ? (
                        <span className="ml-2 text-xs font-normal text-slate-500">You</span>
                      ) : null}
                    </p>
                    <p className="truncate text-sm text-slate-500">{m.email}</p>
                  </div>
                  {m.lastSeenAt ? (
                    <span className="hidden text-sm text-slate-500 sm:block">
                      Last seen {timeAgo(m.lastSeenAt, now)}
                    </span>
                  ) : null}
                  {m.root ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      Owner
                    </span>
                  ) : m.you ? null : (
                    <Popover>
                      <PopoverTrigger
                        render={
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`Options for ${m.email}`}
                            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-48 p-1">
                        <button
                          type="button"
                          onClick={() => setRemoving(m)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-slate-100"
                        >
                          <Trash2 className="size-4" /> Remove access
                        </button>
                      </PopoverContent>
                    </Popover>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Waiting to sign up{" "}
              <span className="font-normal text-slate-500">· {invited.length}</span>
            </h2>
            {invited.length === 0 ? (
              <p className="rounded-2xl border border-dashed bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                No open invites.
              </p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
                {invited.map((m) => (
                  <li key={m._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Mail aria-hidden className="size-4 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{m.email}</p>
                      <p className="text-sm text-slate-500">
                        Invited {dayFormat.format(new Date(m.invitedAt))}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const { email } = await resend({ staffId: m._id });
                          return `Invite emailed again to ${email}.`;
                        })
                      }
                    >
                      Resend invite
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setRemoving(m)}
                    >
                      Cancel
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {inviting ? (
        <InviteDialog
          onClose={() => setInviting(false)}
          onInvited={(email) =>
            setOutcome({
              tone: "done",
              text: `Invite emailed to ${email}. They can create their account from that email.`,
            })
          }
        />
      ) : null}
      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removing?.status === "invited" ? "Cancel this invite?" : "Remove access?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.status === "invited"
                ? `${removing.email} won't be able to create an account from the invite email.`
                : `${removing?.name ?? removing?.email} will be signed out and can't open the console again unless you invite them back.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const member = removing;
                setRemoving(null);
                if (member)
                  void act(async () => {
                    await remove({ staffId: member._id });
                    return member.status === "invited"
                      ? `The invite to ${member.email} is cancelled.`
                      : `${member.email} no longer has access.`;
                  });
              }}
            >
              {removing?.status === "invited" ? "Cancel invite" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Notice({ outcome }: { outcome: Outcome }) {
  if (outcome.tone === "fault")
    return (
      <p role="alert" className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-800">
        {outcome.text}
      </p>
    );
  return (
    <p
      role="status"
      className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900"
    >
      {outcome.text}
    </p>
  );
}

function InviteDialog({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: (email: string) => void;
}) {
  const invite = useAction(api.staff.invite);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>
            They get an email with a link to create their account. Once they sign in, they
            can do everything you can here.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              const invited = await invite({ email });
              setBusy(false);
              onInvited(invited.email);
              onClose();
            } catch (err) {
              setError(errorMessage(err));
              setBusy(false);
            }
          }}
        >
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="invite-email">Email</FieldLabel>
            <Input
              id="invite-email"
              type="email"
              autoFocus
              autoComplete="off"
              value={email}
              disabled={busy}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setEmail(event.target.value);
                setError("");
              }}
            />
            <FieldDescription className={error ? "text-destructive" : undefined}>
              {error || "They'll need to sign up with this exact email."}
            </FieldDescription>
          </Field>
          <Button type="submit" disabled={busy}>
            <Send data-icon="inline-start" aria-hidden />
            {busy ? "Sending…" : "Send invite"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
