"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  KeyRound,
  LoaderCircle,
  MapPinOff,
  Pencil,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { PrototypeSwitcher, useVariant } from "@/components/prototype/prototype-switcher";
import { SiteDialog } from "@/components/site-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

// PROTOTYPE (#90): three variants of the site page header and tab row,
// switchable via ?variant=, on the real /sites/<id> route. The tabs' content
// is the same under each.
//   A · Plain    the customer hub's idiom: title, lines under it, underline tabs
//   B · Sticky   compact header that sticks on scroll, pill tabs, floating Take photo
//   C · Card     header as a card of rows, full-width tabs
const VARIANTS = [
  { key: "A", name: "Plain" },
  { key: "B", name: "Sticky" },
  { key: "C", name: "Card" },
] as const;

const TABS = [
  { key: "proposals", label: "Proposals" },
  { key: "solutions", label: "Solutions" },
  { key: "photos", label: "Photos" },
  { key: "invoices", label: "Invoices" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type SiteDetail = NonNullable<FunctionReturnType<typeof api.sitesPrototype.get>>;

export function SiteHubShell({ siteId, children }: { siteId: string; children: ReactNode }) {
  const variant = useVariant(VARIANTS.map((v) => v.key));
  const detail = useQuery(api.sitesPrototype.get, { siteId: siteId as Id<"sites"> });
  const [editing, setEditing] = useState(false);
  const pathname = usePathname();
  const active = (pathname.slice(`/sites/${siteId}`.length + 1).split("/")[0] ||
    "proposals") as TabKey;

  if (detail === undefined) {
    return (
      <div className="grid min-h-64 place-items-center">
        <LoaderCircle aria-label="Loading site" className="size-6 animate-spin text-slate-500" />
      </div>
    );
  }
  if (detail === null) return <SiteNotFound />;

  const props = { detail, siteId, active, onEdit: () => setEditing(true) };
  return (
    <>
      {variant === "A" ? <VariantA {...props}>{children}</VariantA> : null}
      {variant === "B" ? <VariantB {...props}>{children}</VariantB> : null}
      {variant === "C" ? <VariantC {...props}>{children}</VariantC> : null}
      {editing && detail.customer ? (
        <SiteDialog
          customerId={detail.customer.customerId}
          site={detail.site}
          onClose={() => setEditing(false)}
        />
      ) : null}
      <PrototypeSwitcher variants={VARIANTS} current={variant} />
    </>
  );
}

type VariantProps = {
  detail: SiteDetail;
  siteId: string;
  active: TabKey;
  onEdit: () => void;
  children: ReactNode;
};

function tabCount(detail: SiteDetail, key: TabKey) {
  if (key === "proposals") return detail.counts.proposals;
  if (key === "solutions") return detail.counts.solutions;
  if (key === "invoices") return detail.counts.invoices;
  return null;
}

// A · Plain: the customer hub one level down. Street as the title, city line,
// customer and access notes as short lines, Edit site on the right, underline
// tabs. What the owner already knows.
function VariantA({ detail, siteId, active, onEdit, children }: VariantProps) {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{detail.street}</h1>
          <p className="text-sm text-muted-foreground">{detail.cityLine}</p>
          {detail.customer ? (
            <p className="text-sm">
              <Link
                href={`/customers/${detail.customer.customerId}`}
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
              >
                <User aria-hidden className="size-3.5" />
                {detail.customer.name}
              </Link>
            </p>
          ) : null}
          {detail.site.accessNotes ? (
            <p className="text-sm text-slate-600">
              <KeyRound aria-hidden className="mr-1 inline size-3.5 text-slate-400" />
              {detail.site.accessNotes}
            </p>
          ) : null}
        </div>
        <Button variant="outline" size="lg" onClick={onEdit}>
          <Pencil data-icon="inline-start" aria-hidden /> Edit site
        </Button>
      </header>
      <nav aria-label="Site sections" className="border-b">
        <ul className="no-scrollbar -mb-px flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <li key={tab.key}>
              <Link
                href={`/sites/${siteId}/${tab.key}`}
                aria-current={tab.key === active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  tab.key === active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {tab.label}
                <Count n={tabCount(detail, tab.key)} />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </div>
  );
}

// B · Sticky: built for the phone in the driveway. A compact header that
// stays put as the list scrolls, the customer as a chip beside the address,
// pill tabs, and on the Photos tab a big Take photo button floating bottom
// right so the camera is one thumb away.
function VariantB({ detail, siteId, active, onEdit, children }: VariantProps) {
  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-8 -mt-8 border-b bg-white/95 px-4 pt-3 pb-2 backdrop-blur sm:px-8">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">{detail.street}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>{detail.cityLine}</span>
              {detail.customer ? (
                <Link
                  href={`/customers/${detail.customer.customerId}`}
                  className="inline-flex items-center gap-1 rounded-full border bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  <User aria-hidden className="size-3" />
                  {detail.customer.name}
                </Link>
              ) : null}
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Edit site" onClick={onEdit}>
            <Pencil aria-hidden />
          </Button>
        </div>
        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={`/sites/${siteId}/${tab.key}`}
              aria-current={tab.key === active ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium whitespace-nowrap",
                tab.key === active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "bg-white text-slate-600 hover:text-slate-900",
              )}
            >
              {tab.label}
              <Count n={tabCount(detail, tab.key)} dark={tab.key === active} />
            </Link>
          ))}
        </div>
      </div>
      {detail.site.accessNotes ? (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <KeyRound aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>{detail.site.accessNotes}</span>
        </p>
      ) : null}
      {children}
      {active === "photos" ? (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("proto-take-photo"))}
          className="fixed right-4 bottom-16 z-40 inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3.5 text-base font-semibold text-white shadow-xl active:scale-95 sm:hidden"
        >
          <Camera aria-hidden className="size-5" /> Take photo
        </button>
      ) : null}
    </div>
  );
}

// C · Card: the header is a card of labelled rows (address, customer, access
// notes, each a thing to tap), then the tabs split the width like an iOS
// segmented control. Slower to scan, harder to miss.
function VariantC({ detail, siteId, active, onEdit, children }: VariantProps) {
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Site</p>
            <h1 className="text-xl font-semibold tracking-tight">{detail.street}</h1>
            <p className="text-sm text-muted-foreground">{detail.cityLine}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil data-icon="inline-start" aria-hidden /> Edit
          </Button>
        </div>
        {detail.customer ? (
          <Link
            href={`/customers/${detail.customer.customerId}`}
            className="flex items-center gap-3 border-t px-5 py-3 hover:bg-slate-50"
          >
            <User aria-hidden className="size-4 text-slate-400" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-slate-500">Customer</span>
              <span className="block truncate font-medium text-slate-900">
                {detail.customer.name}
              </span>
            </span>
            <ChevronRight aria-hidden className="size-4 text-slate-400" />
          </Link>
        ) : null}
        <div className="flex items-start gap-3 border-t px-5 py-3">
          <KeyRound aria-hidden className="mt-0.5 size-4 text-slate-400" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-slate-500">Access</span>
            <span
              className={cn(
                "block text-sm",
                detail.site.accessNotes ? "text-slate-900" : "text-slate-400",
              )}
            >
              {detail.site.accessNotes || "No access notes"}
            </span>
          </span>
        </div>
      </section>
      <nav aria-label="Site sections" className="grid grid-cols-4 rounded-xl border bg-white p-1">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/sites/${siteId}/${tab.key}`}
            aria-current={tab.key === active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center rounded-lg px-1 py-1.5 text-sm font-medium",
              tab.key === active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50",
            )}
          >
            <span>{tab.label}</span>
            <span
              className={cn(
                "text-xs tabular-nums",
                tab.key === active ? "text-slate-300" : "text-slate-400",
              )}
            >
              {tabCount(detail, tab.key) ?? " "}
            </span>
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

function Count({ n, dark }: { n: number | null; dark?: boolean }) {
  if (n === null || n === 0) return null;
  return (
    <span
      className={cn(
        "rounded-full px-1.5 text-xs tabular-nums",
        dark ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600",
      )}
    >
      {n}
    </span>
  );
}

function SiteNotFound() {
  return (
    <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed bg-slate-50 text-center">
      <div className="px-6">
        <MapPinOff className="mx-auto size-7 text-slate-400" />
        <h1 className="mt-3 font-semibold text-slate-900">No such site</h1>
        <p className="mt-1 text-sm text-slate-500">
          This link names a site that does not exist, or one that has since been removed.
        </p>
        <Link
          href="/sites"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to Sites
        </Link>
      </div>
    </div>
  );
}
