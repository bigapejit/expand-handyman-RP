"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { CustomerFields, blankCustomer } from "./customer-fields";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  FileText,
  Upload,
  Plus,
  Search,
  ArrowUpRight,
  Users,
  MapPin,
} from "lucide-react";
import { dateTime, errorMessage } from "@/lib/utils";
import { MAX_PDF_BYTES } from "@/lib/signing";
import { uploadFile } from "@/lib/files";
import {
  customerErrors,
  customerSchema,
  displayPhone,
  type CustomerErrors,
  type CustomerInput,
} from "@/lib/customer";

export function Status({ status }: { status: string }) {
  return (
    <Badge
      variant="secondary"
      className={
        status === "signed"
          ? "bg-emerald-50 text-emerald-800"
          : status === "viewed"
            ? "bg-blue-50 text-blue-800"
            : status === "ready"
              ? "bg-amber-50 text-amber-800"
              : ""
      }
    >
      {(
        {
          draft: "Draft",
          ready: "Link ready",
          viewed: "Viewed",
          signed: "Signed",
          declined: "Declined",
        } as Record<string, string>
      )[status] ?? status}
    </Badge>
  );
}
export function Dashboard({
  customersOnly = false,
}: {
  customersOnly?: boolean;
}) {
  const documents = useQuery(api.documents.list);
  const customers = useQuery(api.documents.customers);
  const addCustomer = useMutation(api.documents.addCustomer);
  const getUploadUrl = useMutation(api.documents.uploadUrl);
  const createDocument = useAction(api.pdfActions.create);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [modal, setModal] = useState<"customer" | "upload" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customer, setCustomer] = useState<CustomerInput>(blankCustomer);
  const [fieldErrors, setFieldErrors] = useState<CustomerErrors>({});
  const router = useRouter();
  const open = (value: "customer" | "upload") => {
    setError("");
    if (value === "customer") {
      setCustomer(blankCustomer);
      setFieldErrors({});
    }
    setModal(value);
  };
  const filtered = documents?.filter(
    (d) =>
      (status === "all" || d.status === status) &&
      `${d.title} ${d.customerName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <main className="mx-auto max-w-7xl p-5 md:p-9">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            Workspace / {customersOnly ? "Customers" : "Documents"}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {customersOnly ? "Customers" : "Documents"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {customersOnly
              ? "Your customers, each with one service address."
              : "Prepare, share, and keep track of customer signatures."}
          </p>
        </div>
        <Button
          size="lg"
          onClick={() =>
            open(
              customersOnly
                ? "customer"
                : customers?.length
                  ? "upload"
                  : "customer",
            )
          }
        >
          {customersOnly ? <Plus /> : <Upload />}
          {customersOnly ? "Add customer" : "Upload PDF"}
        </Button>
      </header>
      {!customersOnly && (
        <div className="mb-8 grid grid-cols-3 gap-3">
          {[
            { label: "All documents", count: documents?.length ?? 0 },
            {
              label: "Awaiting signature",
              count:
                documents?.filter(
                  (d) => d.status === "ready" || d.status === "viewed",
                ).length ?? 0,
            },
            {
              label: "Signed",
              count:
                documents?.filter((d) => d.status === "signed").length ?? 0,
            },
          ].map((s) => (
            <Card key={s.label} className="shadow-none">
              <CardContent className="p-4 md:p-5">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {documents ? s.count : "—"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute top-2 left-3 size-4 text-muted-foreground" />
          <Input
            aria-label="Search"
            className="pl-9"
            placeholder={
              customersOnly
                ? "Search customers…"
                : "Search documents or customers…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {!customersOnly && (
          <div className="flex gap-1">
            {["all", "draft", "ready", "viewed", "signed", "declined"].map((s) => (
              <Button
                key={s}
                size="sm"
                variant={s === status ? "secondary" : "ghost"}
                onClick={() => setStatus(s)}
              >
                {s === "all"
                  ? "All"
                  : s === "ready"
                    ? "Link ready"
                    : s[0].toUpperCase() + s.slice(1)}
              </Button>
            ))}
          </div>
        )}
      </div>
      {customersOnly ? (
        <Card className="overflow-hidden shadow-none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers
                ?.filter((c) =>
                  `${c.name} ${c.site}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((c) => (
                  <TableRow key={c._id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <MapPin className="size-3 text-muted-foreground" />
                        {c.site}
                      </span>
                    </TableCell>
                    <TableCell>
                      <p>{c.email || "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {displayPhone(c.phone)}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setCustomerId(c._id);
                          open("upload");
                        }}
                      >
                        <Upload />
                        Upload PDF
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          {customers?.length === 0 && (
            <Empty
              icon="customers"
              title="Add your first customer"
              body="Keep their documents and service address together."
              action={() => open("customer")}
              actionLabel="Add customer"
            />
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden shadow-none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last viewed</TableHead>
                <TableHead>Created</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered?.map((d) => (
                <TableRow key={d._id}>
                  <TableCell>
                    <Link
                      href={`/documents/${d._id}`}
                      className="flex items-center gap-3 font-medium hover:underline"
                    >
                      <span className="rounded-lg bg-muted p-2">
                        <FileText className="size-4 text-muted-foreground" />
                      </span>
                      {d.title}
                    </Link>
                  </TableCell>
                  <TableCell>{d.customerName}</TableCell>
                  <TableCell>
                    <Status status={d.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {dateTime(d.lastViewedAt)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(d._creationTime).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/documents/${d._id}`}
                      aria-label={`Open ${d.title}`}
                    >
                      <ArrowUpRight size={16} />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {documents === undefined ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              Loading documents…
            </p>
          ) : filtered?.length === 0 ? (
            <Empty
              icon="documents"
              title={
                documents.length
                  ? "No matching documents"
                  : "Your first signature starts here"
              }
              body={
                documents.length
                  ? "Try a different search or status."
                  : "Upload a PDF, place the signature, and send your customer a link."
              }
              action={() => open(customers?.length ? "upload" : "customer")}
              actionLabel={
                customers?.length ? "Upload PDF" : "Add your first customer"
              }
            />
          ) : null}
        </Card>
      )}
      <Dialog
        open={modal !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setModal(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {modal === "customer" ? "Add customer" : "Upload a document"}
            </DialogTitle>
            <DialogDescription>
              {modal === "customer"
                ? "One customer, one service address."
                : "Choose a PDF to prepare for a customer signature."}
            </DialogDescription>
          </DialogHeader>
          {modal === "customer" ? (
            <form
              className="grid gap-4"
              noValidate
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                const parsed = customerSchema.safeParse(customer);
                if (!parsed.success)
                  return setFieldErrors(customerErrors(parsed.error));
                setFieldErrors({});
                setBusy(true);
                try {
                  const id = await addCustomer(parsed.data);
                  setCustomerId(id);
                  setModal(customersOnly ? null : "upload");
                } catch (err) {
                  setError(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <CustomerFields
                value={customer}
                onChange={setCustomer}
                errors={fieldErrors}
                disabled={busy}
              />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save customer"}
              </Button>
            </form>
          ) : (
            <form
              className="grid gap-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const data = new FormData(e.currentTarget);
                const file = data.get("pdf") as File;
                try {
                  if (
                    !file ||
                    file.size > MAX_PDF_BYTES ||
                    !file.name.toLowerCase().endsWith(".pdf")
                  )
                    throw new Error("Choose a PDF under 20 MB.");
                  const id = await uploadFile(await getUploadUrl(), file);
                  const docId = await createDocument({
                    storageId: id as Id<"_storage">,
                    customerId: String(data.get("customer")) as Id<"customers">,
                    title:
                      String(data.get("title")) ||
                      file.name.replace(/\.pdf$/i, ""),
                  });
                  router.push(`/documents/${docId}`);
                } catch (err) {
                  setError(errorMessage(err));
                  setBusy(false);
                }
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="customer">Customer</Label>
                <select
                  id="customer"
                  name="customer"
                  required
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="h-9 rounded-lg border bg-background px-2 text-sm"
                >
                  <option value="" disabled>
                    Select a customer
                  </option>
                  {customers?.map((c) => (
                    <option key={c._id} value={c._id}>
                      {[c.name, c.site, displayPhone(c.phone)]
                        .filter(Boolean)
                        .join(" · ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="title">Document title</Label>
                <Input
                  name="title"
                  id="title"
                  placeholder="e.g. Bathroom repair agreement"
                  maxLength={200}
                />
              </div>
              <div className="rounded-lg border border-dashed bg-muted/30 p-6">
                <Label htmlFor="pdf" className="mb-3 flex items-center gap-2">
                  <Upload size={18} />
                  PDF document
                </Label>
                <Input
                  id="pdf"
                  name="pdf"
                  type="file"
                  accept="application/pdf,.pdf"
                  required
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  Up to 20 MB · 100 pages · No password protection
                </p>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy}>
                {busy
                  ? "Uploading and checking PDF…"
                  : "Upload & place signature"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
function Empty({
  icon,
  title,
  body,
  action,
  actionLabel,
}: {
  icon: string;
  title: string;
  body: string;
  action: () => void;
  actionLabel: string;
}) {
  const Icon = icon === "customers" ? Users : FileText;
  return (
    <div className="flex flex-col items-center px-5 py-20 text-center">
      <span className="mb-5 rounded-2xl bg-muted p-4">
        <Icon className="size-7 text-muted-foreground" />
      </span>
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{body}</p>
      <Button className="mt-6" variant="outline" onClick={action}>
        <Plus />
        {actionLabel}
      </Button>
    </div>
  );
}
