"use client";

// PROTOTYPE. New deal: pick an existing customer (real list from Convex) or
// type a new name, say what the job is and where it came from. Lands in New.
// Nothing is written to Convex; the deal lives in the page's memory.

import { Check, Search } from "lucide-react";
import { useState } from "react";

import { SourceBadge } from "@/components/pipeline-prototype/bits";
import { useDeals } from "@/components/pipeline-prototype/store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { useCustomers } from "@/hooks/use-customers";
import { SOURCES, type Deal, type Source } from "@/lib/pipeline-prototype";
import { cn } from "@/lib/utils";

export function NewDealDialog({ onClose, onCreated }: { onClose: () => void; onCreated?: (deal: Deal) => void }) {
  const { addDeal } = useDeals();
  const customers = useCustomers();
  const [who, setWho] = useState<"existing" | "new">("existing");
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [title, setTitle] = useState("");
  const [site, setSite] = useState("");
  const [source, setSource] = useState<Source>("phone");
  const [note, setNote] = useState("");
  const [ballpark, setBallpark] = useState("");

  const picked = customers?.find((c) => c._id === customerId) ?? null;
  const shown = (customers ?? [])
    .filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 6);
  const customerName = who === "existing" ? picked?.name ?? "" : newName.trim();
  const ready = customerName && title.trim();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New deal</DialogTitle>
          <DialogDescription>A job you are chasing. It starts in New.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            const cents = Math.round(Number(ballpark.replace(/[^0-9.]/g, "")) * 100);
            const deal = addDeal({
              customerName,
              customerId: who === "existing" ? picked?._id : undefined,
              title: title.trim(),
              site: site.trim() || undefined,
              source,
              note,
              valueCents: Number.isFinite(cents) && cents > 0 ? cents : undefined,
            });
            onCreated?.(deal);
            onClose();
          }}
        >
          <div className="space-y-2">
            <Label>Customer</Label>
            <Segmented<"existing" | "new">
              label="Customer"
              value={who}
              onChange={setWho}
              options={[
                { value: "existing", label: "Existing" },
                { value: "new", label: "New customer" },
              ]}
            />
            {who === "existing" ? (
              <div className="space-y-1.5">
                <label className="relative block">
                  <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={customers === undefined ? "Loading customers…" : "Search customers"}
                    className="h-9 pl-8"
                  />
                </label>
                <ul className="max-h-44 overflow-y-auto rounded-lg border divide-y">
                  {shown.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-slate-500">No customer matches. Try New customer.</li>
                  ) : (
                    shown.map((c) => (
                      <li key={c._id}>
                        <button
                          type="button"
                          onClick={() => setCustomerId(c._id)}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50",
                            customerId === c._id && "bg-slate-900 text-white hover:bg-slate-900",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{c.name}</span>
                          <span className={cn("text-xs", customerId === c._id ? "text-white/70" : "text-slate-500")}>
                            {c.siteCount === 1 ? "1 site" : `${c.siteCount} sites`}
                          </span>
                          {customerId === c._id ? <Check aria-hidden className="size-4" /> : null}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ) : (
              <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" className="h-9" />
            )}
          </div>

          <div className="space-y-1.5">
            <Label>What's the job?</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Deck board replacement" className="h-9" />
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-1.5">
              <Label>Site (optional)</Label>
              <Input value={site} onChange={(e) => setSite(e.target.value)} placeholder="Street, city" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label>Ballpark</Label>
              <Input value={ballpark} onChange={(e) => setBallpark(e.target.value)} placeholder="$" inputMode="decimal" className="h-9" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Where did it come from?</Label>
            <div className="flex flex-wrap gap-1.5">
              {SOURCES.filter((s) => s !== "thumbtack").map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={source === s}
                  onClick={() => setSource(s)}
                  className={cn(
                    "rounded-lg border px-1.5 py-1 transition",
                    source === s ? "border-slate-900 bg-slate-50" : "border-transparent hover:bg-slate-50",
                  )}
                >
                  <SourceBadge source={s} />
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">Thumbtack deals arrive on their own from the webhook.</p>
          </div>

          <div className="space-y-1.5">
            <Label>First note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What they said on the phone." className="min-h-16" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              Add deal
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{children}</p>;
}
