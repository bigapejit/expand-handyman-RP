"use client";

import { useMutation, useQuery } from "convex/react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import {
  dollarsField,
  jobMath,
  jobMathSettingsFault,
  jobMathSettingsFaultMessage,
  readDollarsField,
  readHoursField,
  readJobMathSettings,
  type JobMathSettings,
} from "@/lib/job-math";
import { formatCents } from "@/lib/money";
import { cn, errorMessage } from "@/lib/utils";

type Fields = { price: string; hours: string; other: string; wage: string };

// The owner's Job math settings, or undefined while they load. Defaults fill
// anything the answer lacks, so a deployment whose `settings.get` predates Job
// math still shows the math rather than a spinner forever.
export function useJobMathSettings(): JobMathSettings | undefined {
  const settings = useQuery(api.settings.get);
  return settings === undefined ? undefined : readJobMathSettings(settings.jobMath);
}

// **Job math** (CONTEXT.md): four figures typed in, and what they come to,
// recomputed on every keystroke from lib/job-math.ts. Nothing typed here is
// saved; only the percentages under "Your percentages" are.
export function JobMathPage({ initial }: { initial: Fields }) {
  const settings = useJobMathSettings();
  const [fields, setFields] = useState<Fields>(initial);
  const set = (key: keyof Fields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-4 rounded-2xl border bg-white p-5 shadow-sm md:grid-cols-4">
        <MoneyField label="Price" value={fields.price} onChange={set("price")} />
        <NumberField label="Labor hours" value={fields.hours} onChange={set("hours")} />
        <MoneyField
          label="Materials & other costs"
          value={fields.other}
          onChange={set("other")}
        />
        <MoneyField
          label="Wage you'd pay"
          suffix="/hr"
          value={fields.wage}
          // Empty means the default wage, shown where the figure would be.
          placeholder={settings ? dollarsField(settings.wageCents) : ""}
          onChange={set("wage")}
        />
      </section>

      {settings === undefined ? (
        <div className="grid min-h-40 place-items-center">
          <LoaderCircle
            aria-label="Loading"
            className="size-6 animate-spin text-slate-500"
          />
        </div>
      ) : (
        <Readout
          fields={fields}
          settings={settings}
          onUsePrice={(cents) => set("price")(dollarsField(cents))}
        />
      )}

      {settings === undefined ? null : <YourPercentages settings={settings} />}
    </div>
  );
}

function Readout({
  fields,
  settings,
  onUsePrice,
}: {
  fields: Fields;
  settings: JobMathSettings;
  onUsePrice: (cents: number) => void;
}) {
  const priceCents = readDollarsField(fields.price);
  if (priceCents === null) {
    return (
      <p className="rounded-2xl border border-dashed bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
        Type a price to see what the job leaves you.
      </p>
    );
  }
  const laborHours = Math.max(0, readHoursField(fields.hours) ?? 0);
  const otherCostCents = readDollarsField(fields.other) ?? 0;
  const wageCents = Math.max(0, readDollarsField(fields.wage) ?? settings.wageCents);
  const math = jobMath({ priceCents, laborHours, otherCostCents, wageCents }, settings);
  const { owner, w2 } = math;
  const perHour = (cents: number) => `${formatCents(cents)}/hr`;
  const wageLabel = perHour(wageCents);

  // Worth saying only when there is work or a cost to cover, and when the
  // price typed isn't already it.
  const charge = math.priceForWageCents;
  const showCharge =
    charge !== null && charge !== priceCents && (laborHours > 0 || otherCostCents > 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        {math.buckets.map((bucket, at) => (
          <span key={bucket.key} className="whitespace-nowrap">
            {at > 0 ? <span aria-hidden> · </span> : null}
            {bucket.label}{" "}
            <span className="font-medium text-slate-900 tabular-nums">
              {formatCents(bucket.cents)}
            </span>
          </span>
        ))}
        {otherCostCents !== 0 ? (
          <span className="whitespace-nowrap">
            <span aria-hidden> · </span>Materials & other{" "}
            <span className="font-medium text-slate-900 tabular-nums">
              {formatCents(otherCostCents)}
            </span>
          </span>
        ) : null}
      </p>

      {showCharge ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4">
          <p className="text-sm text-slate-900">
            {laborHours > 0
              ? `To pay ${wageLabel} and keep your buckets, charge `
              : "To cover your costs and keep your buckets, charge "}
            <span className="font-semibold tabular-nums">{formatCents(charge)}</span>.
          </p>
          <Button size="sm" variant="outline" onClick={() => onUsePrice(charge)}>
            Use {formatCents(charge)}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="You do it">
          <Line label="Left for labor" value={formatCents(owner.payCents)} />
          <Line
            label={`Tax set-aside (${settings.ownerTaxPercent}%)`}
            value={formatCents(owner.taxSetAsideCents)}
          />
          <Line
            label="You take home"
            value={formatCents(owner.takeHomeCents)}
            total
            bad={owner.takeHomeCents < 0}
          />
          <Line
            label="Per hour"
            value={
              owner.takeHomePerHourCents === null
                ? "—"
                : perHour(owner.takeHomePerHourCents)
            }
            bad={(owner.takeHomePerHourCents ?? 0) < 0}
          />
        </Panel>

        <Panel title="Hire someone (W-2)">
          <Line
            label="Most you can pay"
            value={
              w2.maxWageCents === null
                ? "—"
                : w2.maxWageCents <= 0
                  ? "Can't afford anyone"
                  : perHour(w2.maxWageCents)
            }
            strong
            bad={w2.maxWageCents !== null && w2.maxWageCents <= 0}
          />
          <p className="pt-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
            At {wageLabel}
          </p>
          <Line label="Wages" value={formatCents(w2.atWage.wagesCents)} />
          <Line
            label={`Payroll taxes (${settings.payrollTaxPercent}%)`}
            value={formatCents(w2.atWage.payrollTaxCents)}
          />
          <Line
            label={`L&I (${perHour(settings.workersCompCentsPerHour)})`}
            value={formatCents(w2.atWage.workersCompCents)}
          />
          <Line label="Total cost" value={formatCents(w2.atWage.totalCostCents)} />
          <Line
            label="Left over"
            value={formatCents(w2.atWage.leftOverCents)}
            total
            bad={w2.atWage.leftOverCents < 0}
          />
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <h2 className="mb-3 font-semibold text-slate-950">{title}</h2>
      <dl className="space-y-1.5 text-sm">{children}</dl>
    </section>
  );
}

function Line({
  label,
  value,
  strong,
  total,
  bad,
}: {
  label: string;
  value: string;
  // The figure the card is for; a total also sits under a rule.
  strong?: boolean;
  total?: boolean;
  bad?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-6",
        strong || total ? "font-semibold text-slate-900" : "text-slate-600",
        total && "border-t pt-1.5",
        bad && "text-destructive",
      )}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function MoneyField({
  label,
  suffix,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  suffix?: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-slate-500"
        >
          $
        </span>
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={cn("bg-white pl-6 tabular-nums", suffix && "pr-9")}
        />
        {suffix ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-slate-500"
          >
            {suffix}
          </span>
        ) : null}
      </div>
    </Field>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-white tabular-nums"
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------
// The percentages and rates every job is worked out with, folded away until
// asked for: set once and rarely touched.

type SettingsFields = Record<keyof JobMathSettings, string>;

const SettingsRows: { key: keyof JobMathSettings; label: string; unit: "%" | "$/hr" }[] = [
  { key: "profitPercent", label: "Profit", unit: "%" },
  { key: "marketingPercent", label: "Marketing", unit: "%" },
  { key: "opsPercent", label: "Ops (gas, gear, insurance, B&O)", unit: "%" },
  { key: "ownerTaxPercent", label: "Your tax set-aside", unit: "%" },
  { key: "payrollTaxPercent", label: "Payroll taxes on a W-2 wage", unit: "%" },
  { key: "workersCompCentsPerHour", label: "L&I per hour worked", unit: "$/hr" },
  { key: "wageCents", label: "Wage you'd pay", unit: "$/hr" },
];

function isMoney(key: keyof JobMathSettings): boolean {
  return key === "workersCompCentsPerHour" || key === "wageCents";
}

function toFields(settings: JobMathSettings): SettingsFields {
  const fields = {} as SettingsFields;
  for (const { key } of SettingsRows) {
    fields[key] = isMoney(key) ? dollarsField(settings[key]) : String(settings[key]);
  }
  return fields;
}

// A field that isn't a figure reads as NaN, which the fault refuses in words,
// rather than as 0, which it would accept.
function fromFields(fields: SettingsFields): JobMathSettings {
  const settings = {} as JobMathSettings;
  for (const { key } of SettingsRows) {
    settings[key] = isMoney(key)
      ? (readDollarsField(fields[key]) ?? Number.NaN)
      : (readHoursField(fields[key].replace(/%$/, "")) ?? Number.NaN);
  }
  return settings;
}

function YourPercentages({ settings }: { settings: JobMathSettings }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <section className="rounded-2xl border bg-white shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <span>
          <span className="block font-semibold text-slate-950">Your percentages</span>
          <span className="block text-sm text-slate-500">
            Buckets {settings.profitPercent}% · {settings.marketingPercent}% ·{" "}
            {settings.opsPercent}%, tax {settings.ownerTaxPercent}%
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn("size-4 text-slate-500 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div id={panelId} className="border-t px-5 py-5">
          <SettingsForm settings={settings} />
        </div>
      ) : null}
    </section>
  );
}

function SettingsForm({ settings }: { settings: JobMathSettings }) {
  const save = useMutation(api.settings.setJobMath);
  const [fields, setFields] = useState<SettingsFields>(() => toFields(settings));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "done" | "fault"; text: string } | null>(
    null,
  );

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const next = fromFields(fields);
        // The same refusal the mutation would send back, without the trip.
        const fault = jobMathSettingsFault(next);
        if (fault) {
          setMessage({ tone: "fault", text: jobMathSettingsFaultMessage(fault) });
          return;
        }
        setBusy(true);
        try {
          await save(next);
          setMessage({
            tone: "done",
            text: "Saved. Every job is worked out with these now.",
          });
        } catch (err) {
          setMessage({ tone: "fault", text: errorMessage(err) });
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-slate-500">
        The buckets come off the top of every price, before sales tax, which the customer
        pays on top. Your tax set-aside comes out of your own pay. Payroll taxes and L&I are
        what an employer pays on top of a W-2 wage.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {SettingsRows.map((row) => (
          <SettingField
            key={row.key}
            label={row.label}
            unit={row.unit}
            value={fields[row.key]}
            disabled={busy}
            onChange={(value) => {
              setFields((current) => ({ ...current, [row.key]: value }));
              setMessage(null);
            }}
          />
        ))}
      </div>
      {message ? (
        <FieldDescription
          role={message.tone === "fault" ? "alert" : "status"}
          className={message.tone === "fault" ? "text-destructive" : "text-emerald-700"}
        >
          {message.text}
        </FieldDescription>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

function SettingField({
  label,
  unit,
  value,
  disabled,
  onChange,
}: {
  label: string;
  unit: "%" | "$/hr";
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        {unit === "$/hr" ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-slate-500"
          >
            $
          </span>
        ) : null}
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={cn("bg-white pr-9 tabular-nums", unit === "$/hr" && "pl-6 pr-10")}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-slate-500"
        >
          {unit === "%" ? "%" : "/hr"}
        </span>
      </div>
    </Field>
  );
}
