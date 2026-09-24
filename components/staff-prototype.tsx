"use client";

// PROTOTYPE ONLY — throwaway. Three variants of a Staff page (invite-only
// access list), switchable via `?variant=`, on a throwaway `/staff` route.
// State is in memory; nothing here talks to Convex or Clerk.

import { useSearchParams } from "next/navigation";
import {
  Clock,
  Mail,
  MoreHorizontal,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { Monogram } from "@/components/monogram";
import { PageHeader } from "@/components/page-header";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { cn } from "@/lib/utils";

type Member = {
  email: string;
  name?: string;
  status: "active" | "invited";
  since: string;
  lastSeen?: string;
  you?: boolean;
  root?: boolean;
};

const seed: Member[] = [
  {
    email: "andrew.p@expandhandyman.com",
    name: "Andrew Putilin",
    status: "active",
    since: "Sep 2",
    lastSeen: "now",
    you: true,
    root: true,
  },
  {
    email: "matt@expandhandyman.com",
    name: "Matt Rivera",
    status: "active",
    since: "Sep 14",
    lastSeen: "2 hours ago",
  },
  { email: "dad.putilin@gmail.com", status: "invited", since: "Sep 22" },
];

const variants = [
  { key: "A", name: "One list, inline invite" },
  { key: "B", name: "Two sections, invite dialog" },
  { key: "C", name: "Table with explainer" },
];

function useStaffState() {
  const [members, setMembers] = useState<Member[]>(seed);
  const [notice, setNotice] = useState("");
  function invite(raw: string) {
    const email = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter an email address.";
    if (members.some((m) => m.email === email)) return "That email is already on the list.";
    setMembers((m) => [...m, { email, status: "invited", since: "Today" }]);
    setNotice(`Invite emailed to ${email}. They can create their account from that email.`);
    return "";
  }
  function remove(email: string) {
    setMembers((m) => m.filter((x) => x.email !== email));
    setNotice(`${email} no longer has access.`);
  }
  function resend(email: string) {
    setNotice(`Invite emailed again to ${email}.`);
  }
  return { members, notice, invite, remove, resend };
}

export function StaffPrototype() {
  const params = useSearchParams();
  const variant = params.get("variant") ?? "A";
  const state = useStaffState();
  return (
    <>
      {variant === "A" && <VariantA {...state} />}
      {variant === "B" && <VariantB {...state} />}
      {variant === "C" && <VariantC {...state} />}
      <PrototypeSwitcher variants={variants} />
    </>
  );
}

type Props = ReturnType<typeof useStaffState>;

function Notice({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p
      role="status"
      className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900"
    >
      {text}
    </p>
  );
}

function StatusChip({ member }: { member: Member }) {
  if (member.status === "invited")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
        <Clock aria-hidden className="size-3" /> Invited
      </span>
    );
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900">
      <ShieldCheck aria-hidden className="size-3" /> Has access
    </span>
  );
}

/* ------------------------------------------------------------------ A */
// One flat list. The invite box sits in the toolbar like the Customers
// search; removing is one click with an undo line, no dialog.
function VariantA({ members, notice, invite, remove, resend }: Props) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const err = invite(email);
    setError(err);
    if (!err) setEmail("");
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        description="Who can open this console. Everyone on the list can do everything."
      />
      <form onSubmit={submit} className="flex flex-wrap items-start gap-3">
        <label className="relative block w-full max-w-md">
          <Mail
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError("");
            }}
            placeholder="Email address to invite"
            aria-label="Email address to invite"
            aria-invalid={error ? true : undefined}
            className="h-9 pl-8"
          />
          {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
        </label>
        <Button size="lg" type="submit">
          <Send data-icon="inline-start" aria-hidden />
          Send invite
        </Button>
      </form>
      <Notice text={notice} />
      <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
        {members.map((m) => (
          <li key={m.email} className="flex items-center gap-4 px-4 py-3">
            <Monogram name={m.name ?? m.email} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-slate-900">
                {m.name ?? m.email}
                {m.you ? <span className="ml-2 text-xs font-normal text-slate-500">You</span> : null}
              </p>
              <p className="truncate text-sm text-slate-500">
                {m.name ? `${m.email} · ` : ""}
                {m.status === "invited"
                  ? `Invited ${m.since}, hasn't signed up yet`
                  : `Since ${m.since} · last seen ${m.lastSeen}`}
              </p>
            </div>
            <StatusChip member={m} />
            {m.status === "invited" ? (
              <Button size="sm" variant="outline" onClick={() => resend(m.email)}>
                Resend
              </Button>
            ) : null}
            {m.root ? (
              <span className="w-8" aria-hidden />
            ) : (
              <button
                type="button"
                aria-label={`Remove ${m.email}`}
                onClick={() => remove(m.email)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-destructive"
              >
                <X className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        Your own account is the root of the list and can't be removed.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ B */
// Two sections: the people who are in, and the invites still waiting. A
// button opens an invite dialog; removing asks first.
function VariantB({ members, notice, invite, remove, resend }: Props) {
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const active = members.filter((m) => m.status === "active");
  const invited = members.filter((m) => m.status === "invited");
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          title="Staff"
          description="Invite-only. Anyone you invite gets the whole console; nobody else can even create an account."
        />
        <Button size="lg" onClick={() => setInviting(true)}>
          <UserPlus data-icon="inline-start" aria-hidden />
          Invite someone
        </Button>
      </div>
      <Notice text={notice} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Has access <span className="font-normal text-slate-500">· {active.length}</span>
        </h2>
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {active.map((m) => (
            <li key={m.email} className="flex items-center gap-4 px-4 py-3">
              <Monogram name={m.name ?? m.email} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{m.name ?? m.email}</p>
                <p className="truncate text-sm text-slate-500">{m.email}</p>
              </div>
              <span className="hidden text-sm text-slate-500 sm:block">
                Last seen {m.lastSeen}
              </span>
              {m.root ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  Owner
                </span>
              ) : (
                <Popover>
                  <PopoverTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`Options for ${m.email}`}
                        className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
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
              <li key={m.email} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Mail aria-hidden className="size-4 text-amber-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{m.email}</p>
                  <p className="text-sm text-slate-500">Invited {m.since}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => resend(m.email)}>
                  Resend invite
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRemoving(m)}>
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {inviting ? (
        <InviteDialog
          onClose={() => setInviting(false)}
          invite={invite}
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
                if (removing) remove(removing.email);
                setRemoving(null);
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

function InviteDialog({
  onClose,
  invite,
}: {
  onClose: () => void;
  invite: (email: string) => string;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>
            They get an email with a link to create their account. Once they sign in,
            they can do everything you can here.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const err = invite(email);
            if (err) setError(err);
            else onClose();
          }}
        >
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="invite-email">Email</FieldLabel>
            <Input
              id="invite-email"
              type="email"
              autoFocus
              value={email}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
            />
            <FieldDescription className={error ? "text-destructive" : undefined}>
              {error || "They'll need to sign up with this exact email."}
            </FieldDescription>
          </Field>
          <Button type="submit">
            <Send data-icon="inline-start" aria-hidden />
            Send invite
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ C */
// A compact table with an add-row at the bottom, and a card beside it that
// explains how access works so the page teaches itself.
function VariantC({ members, notice, invite, remove, resend }: Props) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    const err = invite(email);
    setError(err);
    if (!err) setEmail("");
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Staff" description="The emails allowed into this console." />
      <Notice text={notice} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="overflow-hidden rounded-2xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Since</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((m) => (
                <tr key={m.email} className="align-middle">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">
                      {m.email}
                      {m.you ? <span className="ml-2 text-xs font-normal text-slate-500">you</span> : null}
                    </p>
                    {m.name ? <p className="text-slate-500">{m.name}</p> : null}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip member={m} />
                  </td>
                  <td className="hidden px-4 py-3 text-slate-500 sm:table-cell">{m.since}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {m.status === "invited" ? (
                      <button
                        type="button"
                        onClick={() => resend(m.email)}
                        className="mr-3 font-medium text-primary hover:underline"
                      >
                        Resend
                      </button>
                    ) : null}
                    {m.root ? null : confirm === m.email ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-slate-500">Sure?</span>
                        <button
                          type="button"
                          onClick={() => {
                            remove(m.email);
                            setConfirm(null);
                          }}
                          className="font-medium text-destructive hover:underline"
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirm(null)}
                          className="text-slate-500 hover:underline"
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirm(m.email)}
                        className="text-slate-500 hover:text-destructive hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50/60">
                <td colSpan={4} className="px-4 py-3">
                  <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
                    <Plus aria-hidden className="size-4 text-slate-400" />
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setError("");
                      }}
                      placeholder="Add an email"
                      aria-label="Email address to invite"
                      aria-invalid={error ? true : undefined}
                      className={cn("h-8 max-w-xs bg-white", error && "border-destructive")}
                    />
                    <Button size="sm" type="submit" variant="outline">
                      Invite
                    </Button>
                    {error ? <span className="text-xs text-destructive">{error}</span> : null}
                  </form>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>How access works</CardTitle>
            <CardDescription>No roles or permissions. On the list means in.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-4 text-sm text-slate-600">
              <li>Add an email. Clerk emails them a sign-up link.</li>
              <li>Only invited emails can create an account at all.</li>
              <li>Once signed in they can do everything you can here.</li>
              <li>Remove them and they're locked out on their next request.</li>
            </ol>
            <p className="mt-4 text-xs text-slate-500">
              Your own account is fixed and can't be removed, so you can never lock yourself out.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
