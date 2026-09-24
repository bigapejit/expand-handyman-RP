"use client";

// PROTOTYPE panel "Quick": the owner's round-3 ask. Built from the app's own
// furniture (SidePanel, FieldHeading, Button, Textarea, the Segmented stage
// picker the Thumbtack panel already uses) so it looks like the rest of the
// console. What it holds:
//   - one tap out to the Thumbtack conversation, when the deal came from there
//   - name, phone, email, address, each with a copy button
//   - the stage
//   - one notes field, saved as you leave it
//   - Take photo, kept in memory for the prototype
//   - Add to Google Calendar, a prefilled event in a new tab
// No chat, no timeline.

import { CalendarPlus, Camera, Check, Copy, ExternalLink, Mail, MapPin, Phone, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SourceBadge, StageChip } from "@/components/pipeline-prototype/bits";
import { StagePicker } from "@/components/pipeline-prototype/deal-detail";
import { useDeals } from "@/components/pipeline-prototype/store";
import { FieldHeading, FieldLabel, SidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCustomers } from "@/hooks/use-customers";
import { money, type Deal } from "@/lib/pipeline-prototype";
import { conversationUrl } from "@/lib/thumbtack";

export function PanelQuick({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const { setStage, setNotes, addPhotos } = useDeals();
  // A real Thumbtack lead's email and phone live on its customer row.
  const customers = useCustomers();
  const customer = deal.customerId ? customers?.find((c) => c._id === deal.customerId) : undefined;
  const phone = deal.phone || customer?.phone || "";
  const email = deal.email || customer?.email || "";

  return (
    <SidePanel
      title={deal.customerName}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          <span>{deal.title}</span>
          <span aria-hidden>·</span>
          <StageChip stage={deal.stage} />
          <SourceBadge source={deal.source} compact />
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-6 pt-5">
        <div className="flex flex-wrap gap-2">
          {deal.lead ? (
            <Button
              size="lg"
              nativeButton={false}
              render={<a href={conversationUrl(deal.lead.negotiationId)} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLink data-icon="inline-start" aria-hidden /> Open on Thumbtack
            </Button>
          ) : null}
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<a href={calendarUrl(deal, phone)} target="_blank" rel="noopener noreferrer" />}
          >
            <CalendarPlus data-icon="inline-start" aria-hidden /> Add to Google Calendar
          </Button>
          <TakePhoto onPhotos={(urls) => addPhotos(deal.id, urls)} />
        </div>

        <div className="space-y-2">
          <FieldHeading>Contact</FieldHeading>
          <dl className="divide-y rounded-xl border bg-white">
            <CopyRow icon={UserRound} label="Name" value={deal.customerName} />
            <CopyRow icon={Phone} label="Phone" value={phone} href={phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : undefined} />
            <CopyRow icon={Mail} label="Email" value={email} href={email ? `mailto:${email}` : undefined} />
            <CopyRow
              icon={MapPin}
              label="Address"
              value={deal.site ?? ""}
              href={deal.site ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(deal.site)}` : undefined}
            />
          </dl>
          {deal.valueCents ? (
            <p className="text-xs text-slate-500">
              {deal.proposal ? `${deal.proposal.code} · ${money(deal.valueCents)} · ${deal.proposal.state}` : `Ballpark ${money(deal.valueCents)}`}
            </p>
          ) : null}
        </div>

        <StagePicker stage={deal.stage} onPick={(stage) => setStage(deal.id, stage)} />

        <NotesField key={deal.id} value={deal.notes ?? ""} onSave={(text) => setNotes(deal.id, text)} />

        {deal.photos?.length ? (
          <div className="space-y-2">
            <FieldHeading>Photos</FieldHeading>
            <ul className="grid grid-cols-3 gap-1 rounded-xl border bg-white p-1 sm:grid-cols-4">
              {deal.photos.map((url, i) => (
                <li key={url} className="aspect-square overflow-hidden rounded-md bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element -- object URL, prototype only */}
                  <img src={url} alt={`Photo ${i + 1}`} className="size-full object-cover" />
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">Prototype: photos stay in this tab. The real thing would save them to the site.</p>
          </div>
        ) : null}

        {deal.lead?.description ? (
          <div className="space-y-2">
            <FieldHeading>What they asked</FieldHeading>
            <p className="rounded-xl border bg-slate-50 p-4 text-sm whitespace-pre-wrap text-slate-900">{deal.lead.description}</p>
          </div>
        ) : null}

        {deal.customerId ? (
          <div className="border-t pt-4">
            <Link
              href={`/customers/${deal.customerId}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900 hover:underline"
            >
              <UserRound aria-hidden className="size-4" /> Open customer
            </Link>
          </div>
        ) : null}
      </div>
    </SidePanel>
  );
}

// One line of the contact card: the value, selectable and a link where one
// makes sense, with the app's copy button beside it (components/copy-link.tsx
// does the same for signing links).
function CopyRow({ icon: Icon, label, value, href }: { icon: typeof Phone; label: string; value: string; href?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Icon aria-hidden className="size-4 shrink-0 text-slate-400" />
      <dt className="w-16 shrink-0 text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-sm">
        {value ? (
          href ? (
            <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="font-medium text-slate-900 hover:underline">
              {value}
            </a>
          ) : (
            <span className="font-medium text-slate-900 select-all">{value}</span>
          )
        ) : (
          <span className="text-slate-400">Not on file</span>
        )}
      </dd>
      {value ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => setState("copied"))
              .catch(() => setState("failed"));
          }}
        >
          {state === "copied" ? (
            <>
              <Check data-icon="inline-start" aria-hidden className="text-emerald-700" /> Copied
            </>
          ) : state === "failed" ? (
            <span className="text-red-700">Select it</span>
          ) : (
            <>
              <Copy data-icon="inline-start" aria-hidden /> Copy
            </>
          )}
        </Button>
      ) : null}
    </div>
  );
}

// Saved when the field is left, the way every panel field in the app commits.
function NotesField({ value, onSave }: { value: string; onSave: (text: string) => void }) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <FieldLabel htmlFor="deal-notes">Notes</FieldLabel>
        <span role="status" className="text-xs text-emerald-700">
          {saved ? "Saved" : ""}
        </span>
      </div>
      <Textarea
        id="deal-notes"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
        onBlur={() => {
          if (text !== value) {
            onSave(text);
            setSaved(true);
          }
        }}
        placeholder="Gate code, where the panel is, what they said on the phone, what to bring."
        className="min-h-28"
      />
    </div>
  );
}

// The Sites Photos tab's Take photo button, pointed at this deal. A hidden
// camera input, as there; the pictures are kept as object URLs.
function TakePhoto({ onPhotos }: { onPhotos: (urls: string[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button size="lg" variant="outline" onClick={() => ref.current?.click()}>
        <Camera data-icon="inline-start" aria-hidden /> Take photo
      </Button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onPhotos(files.map((f) => URL.createObjectURL(f)));
          e.target.value = "";
        }}
      />
    </>
  );
}

// Google Calendar's event template link: opens a new event with the job as
// the title, the site as the place, and the contact in the details. The slot
// is the next full hour, one hour long; the owner moves it on the calendar.
function calendarUrl(deal: Deal, phone: string) {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const details = [deal.customerName, phone, deal.notes].filter(Boolean).join("\n");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${deal.title} · ${deal.customerName}`,
    dates: `${stamp(start)}/${stamp(end)}`,
    details,
    ...(deal.site ? { location: deal.site } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
