"use client";

import { useMutation, useQuery } from "convex/react";
import {
  CalendarPlus,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  UserRound,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SourceBadge, StageChip } from "@/components/deal-chips";
import { LeadAsked } from "@/components/lead-chat";
import type { DealRow } from "@/components/pipeline-board";
import { FieldHeading, FieldLabel, SidePanel } from "@/components/side-panel";
import { PhotoDialog, PhotoTile, UploadTile, usePhotoUploads } from "@/components/site-photos";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useNow } from "@/hooks/use-now";
import { displayPhone } from "@/lib/customer";
import {
  MAX_NOTES,
  OPEN_STAGES,
  STAGE_LABELS,
  calendarUrl,
  isOpen,
  money,
  type Stage,
} from "@/lib/pipeline";
import { telHref } from "@/lib/proposal-paper";
import { proposalStateLabel } from "@/lib/proposals";
import { conversationUrl } from "@/lib/thumbtack";
import { cn, errorMessage } from "@/lib/utils";

/** The search parameter naming the open deal, as `?deal=<id>`. */
export const DealPanelParam = "deal";

// The Quick panel the **Pipeline** opens over itself: what the owner reaches
// for on the way to a job. One tap out to the Thumbtack conversation, the
// contact with a copy button on each line, the stage, the owner's **Notes**,
// the site's photos and what they asked. No chat and no timeline: the chat
// stays on the customer page.
export function DealPanel({
  deal,
  onSetStage,
  onClose,
}: {
  deal: DealRow;
  onSetStage: (dealId: Id<"deals">, stage: Stage) => void;
  onClose: () => void;
}) {
  const now = useNow();
  const siteId = deal.site?.siteId ?? null;
  const photos = usePhotoUploads(siteId);
  const cameraRef = useRef<HTMLInputElement>(null);
  const siteLine = deal.site?.line ?? "";

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
              render={
                <a
                  href={conversationUrl(deal.lead.negotiationId)}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <ExternalLink data-icon="inline-start" aria-hidden /> Open on Thumbtack
            </Button>
          ) : null}
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={
              <a
                href={calendarUrl(
                  {
                    title: deal.title,
                    customerName: deal.customerName,
                    phone: deal.phone ? displayPhone(deal.phone) : "",
                    notes: deal.notes,
                    siteLine: deal.site?.line ?? null,
                  },
                  now,
                )}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <CalendarPlus data-icon="inline-start" aria-hidden /> Add to Google Calendar
          </Button>
          <Button
            size="lg"
            variant="outline"
            disabled={!siteId}
            onClick={() => cameraRef.current?.click()}
          >
            <Camera data-icon="inline-start" aria-hidden /> Take photo
          </Button>
          {/* One shot a tap, as on the site's Photos tab. */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              photos.pick(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        <div className="space-y-2">
          <FieldHeading>Contact</FieldHeading>
          <dl className="divide-y rounded-xl border bg-white">
            <CopyRow icon={UserRound} label="Name" value={deal.customerName} />
            <CopyRow
              icon={Phone}
              label="Phone"
              value={deal.phone ? displayPhone(deal.phone) : ""}
              href={deal.phone ? telHref(deal.phone) : undefined}
              note={deal.phoneFrom === "thumbtack" ? "Thumbtack number" : undefined}
            />
            <CopyRow
              icon={Mail}
              label="Email"
              value={deal.email}
              href={deal.email ? `mailto:${deal.email}` : undefined}
            />
            <CopyRow
              icon={MapPin}
              label="Address"
              value={siteLine}
              href={
                siteLine
                  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(siteLine)}`
                  : undefined
              }
            />
          </dl>
          <Figure deal={deal} />
        </div>

        <StagePicker stage={deal.stage} onPick={(stage) => onSetStage(deal._id, stage)} />

        <NotesField dealId={deal._id} saved={deal.notes} />

        <div className="space-y-2">
          <FieldHeading>Photos</FieldHeading>
          {siteId ? (
            <SitePhotoGrid siteId={siteId} photos={photos} />
          ) : (
            <SitePicker dealId={deal._id} customerId={deal.customerId} />
          )}
          {deal.site ? (
            <SiteLine dealId={deal._id} site={deal.site} uploading={photos.uploads.length > 0} />
          ) : null}
        </div>

        {deal.lead ? (
          <div className="space-y-2">
            <FieldHeading>What they asked</FieldHeading>
            <LeadAsked lead={deal.lead} />
          </div>
        ) : null}

        <div className="border-t pt-4">
          <Link
            href={`/customers/${deal.customerId}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900 hover:underline"
          >
            <UserRound aria-hidden className="size-4" /> Open customer
          </Link>
        </div>
      </div>
    </SidePanel>
  );
}

// The deal's one figure under the contact: the proposal out on it once there
// is one, else the owner's ballpark, else nothing.
function Figure({ deal }: { deal: DealRow }) {
  const text = deal.proposal
    ? `${deal.proposal.code} · ${money(deal.proposal.totalCents)} · ${proposalStateLabel(deal.proposal.state)}`
    : deal.ballparkCents
      ? `Ballpark ${money(deal.ballparkCents)}`
      : null;
  return text ? <p className="text-xs text-slate-500">{text}</p> : null;
}

// One line of the contact card: the value, a link where one makes sense, with
// a copy button beside it that says so for a moment (components/copy-link.tsx
// does the same for signing links). The value stays selectable text, so a
// refused copy still leaves a way to take it.
function CopyRow({
  icon: Icon,
  label,
  value,
  href,
  note,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  href?: string;
  note?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Icon aria-hidden className="size-4 shrink-0 text-slate-400" />
      <dt className="w-16 shrink-0 text-xs font-medium tracking-wide text-slate-500 uppercase">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 truncate text-sm">
        {value ? (
          <>
            {href ? (
              <a
                href={href}
                target={href.startsWith("http") ? "_blank" : undefined}
                rel="noopener noreferrer"
                className="font-medium text-slate-900 hover:underline"
              >
                {value}
              </a>
            ) : (
              <span className="font-medium text-slate-900 select-all">{value}</span>
            )}
            {note ? <span className="text-slate-500"> · {note}</span> : null}
          </>
        ) : (
          <span className="text-slate-400">Not on file</span>
        )}
      </dd>
      {value ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={state === "idle" ? `Copy ${label.toLowerCase()}` : undefined}
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

// The open stages on the Segmented; Won and Lost as their own buttons.
// A closed deal lights no segment, and picking one reopens it.
function StagePicker({ stage, onPick }: { stage: Stage; onPick: (stage: Stage) => void }) {
  return (
    <div className="space-y-2">
      <FieldHeading>Stage</FieldHeading>
      <div className="flex flex-wrap items-center gap-2">
        <div className="no-scrollbar max-w-full overflow-x-auto [&_button]:whitespace-nowrap">
          <Segmented<Stage>
            label="Stage"
            value={stage}
            onChange={onPick}
            options={OPEN_STAGES.map((open) => ({ value: open, label: STAGE_LABELS[open] }))}
          />
        </div>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          aria-pressed={stage === "won"}
          onClick={() => onPick("won")}
          className={cn(
            stage === "won" &&
              "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600/90 hover:text-white",
          )}
        >
          <CheckCircle2 data-icon="inline-start" aria-hidden /> Won
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-pressed={stage === "lost"}
          onClick={() => onPick("lost")}
          className={cn(
            stage === "lost" &&
              "border-slate-600 bg-slate-600 text-white hover:bg-slate-600/90 hover:text-white",
          )}
        >
          <XCircle data-icon="inline-start" aria-hidden /> Lost
        </Button>
      </div>
      {isOpen(stage) ? null : (
        <p className="text-xs text-slate-500">{STAGE_LABELS[stage]}. Pick a stage to reopen it.</p>
      )}
    </div>
  );
}

// The **Notes**, saved when the box is left, the way every panel field in the
// app commits. `saved` is what the deal holds; the box keeps what is typed.
// Only typing makes the box the owner's: until then it follows `saved`, so
// notes changed on the phone show here, and leaving an untouched box never
// writes an old copy over them.
function NotesField({ dealId, saved }: { dealId: Id<"deals">; saved: string }) {
  const setNotes = useMutation(api.deals.setNotes);
  const [text, setText] = useState(saved);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [shown, setShown] = useState(saved);
  if (shown !== saved) {
    setShown(saved);
    if (!dirty) setText(saved);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <FieldLabel htmlFor="deal-notes">Notes</FieldLabel>
        <span role="status" className="text-xs text-emerald-700">
          {status === "saved" ? "Saved" : ""}
        </span>
      </div>
      <Textarea
        id="deal-notes"
        value={text}
        maxLength={MAX_NOTES}
        onChange={(event) => {
          setText(event.target.value);
          setDirty(true);
          setStatus("idle");
        }}
        onBlur={() => {
          if (!dirty) return;
          if (text.trim() === saved) {
            setDirty(false);
            return;
          }
          setStatus("saving");
          setError("");
          setNotes({ dealId, notes: text })
            .then(() => {
              setDirty(false);
              setStatus("saved");
            })
            .catch((err: unknown) => {
              setStatus("idle");
              setError(errorMessage(err));
            });
        }}
        placeholder="Gate code, where the panel is, what they said on the phone, what to bring."
        className="min-h-28"
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// The deal's site's photos, as the site's Photos tab shows them, with the
// ones on their way up leading.
function SitePhotoGrid({
  siteId,
  photos: { uploads, retry, drop },
}: {
  siteId: Id<"sites">;
  photos: ReturnType<typeof usePhotoUploads>;
}) {
  const photos = useQuery(api.photos.forSite, { siteId });
  const [openId, setOpenId] = useState<Id<"photos"> | null>(null);
  const openPhoto = photos?.find((photo) => photo._id === openId);

  if (photos === undefined)
    return (
      <div className="grid min-h-24 place-items-center rounded-xl border bg-white">
        <LoaderCircle aria-label="Loading photos" className="size-5 animate-spin text-slate-500" />
      </div>
    );
  if (photos.length === 0 && uploads.length === 0)
    return (
      <p className="rounded-xl border bg-white px-4 py-6 text-center text-sm text-slate-500">
        No photos of this site yet.
      </p>
    );
  return (
    <>
      <ul className="grid grid-cols-3 gap-1 rounded-xl border bg-white p-1 sm:grid-cols-4">
        {uploads.map((pending) => (
          <UploadTile
            key={pending.key}
            upload={pending}
            retry={() => retry(pending)}
            drop={() => drop(pending)}
          />
        ))}
        {photos.map((photo) => (
          <PhotoTile key={photo._id} photo={photo} onOpen={() => setOpenId(photo._id)} />
        ))}
      </ul>
      {openPhoto ? (
        <PhotoDialog key={openPhoto._id} photo={openPhoto} onClose={() => setOpenId(null)} />
      ) : null}
    </>
  );
}

// Where the photos go, with a way to that site's own page and, for a site
// picked by mistake, back to the picker. Not while a photo is still on its way
// up, which would land on the site being left.
function SiteLine({
  dealId,
  site,
  uploading,
}: {
  dealId: Id<"deals">;
  site: NonNullable<DealRow["site"]>;
  uploading: boolean;
}) {
  const setSite = useMutation(api.deals.setSite);
  const [error, setError] = useState("");
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
        <span>
          Saved to{" "}
          <Link href={`/sites/${site.siteId}/photos`} className="font-medium text-slate-700 hover:underline">
            {site.name}
          </Link>
        </span>
        <button
          type="button"
          disabled={uploading}
          onClick={() => {
            setError("");
            setSite({ dealId, siteId: null }).catch((err: unknown) => setError(errorMessage(err)));
          }}
          className="font-medium text-slate-700 hover:underline disabled:pointer-events-none disabled:opacity-50"
        >
          Change site
        </button>
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

// A deal with no site yet has nowhere for a photo to go: the owner picks one
// of the customer's sites here, or goes to the customer page to add one.
function SitePicker({ dealId, customerId }: { dealId: Id<"deals">; customerId: Id<"customers"> }) {
  const sites = useQuery(api.sites.forCustomer, { customerId });
  const setSite = useMutation(api.deals.setSite);
  const [error, setError] = useState("");

  if (sites === undefined)
    return (
      <div className="grid min-h-24 place-items-center rounded-xl border bg-white">
        <LoaderCircle aria-label="Loading sites" className="size-5 animate-spin text-slate-500" />
      </div>
    );
  if (sites.length === 0)
    return (
      <div className="space-y-1 rounded-xl border bg-white px-4 py-4 text-sm">
        <p className="text-slate-500">Photos save to the deal&apos;s site, and this customer has none yet.</p>
        <Link href={`/customers/${customerId}`} className="font-medium text-slate-900 hover:underline">
          Add a site on the customer page
        </Link>
      </div>
    );
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">Photos save to the deal&apos;s site. Pick a site.</p>
      <ul className="divide-y overflow-hidden rounded-xl border bg-white">
        {sites.map((site) => (
          <li key={site._id}>
            <button
              type="button"
              onClick={() => {
                setError("");
                setSite({ dealId, siteId: site._id }).catch((err: unknown) =>
                  setError(errorMessage(err)),
                );
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
            >
              <MapPin aria-hidden className="size-4 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{site.streetLine}</span>
                <span className="block truncate text-xs text-slate-500">{site.cityLine}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
