"use client";

import { useQuery } from "convex/react";
import { FileText, LoaderCircle, Search, Upload } from "lucide-react";
import { useState } from "react";

import { UploadPdfDialog } from "@/components/document-dialogs";
import {
  DocumentStatusChip,
  documentStatusLabels,
  type DocumentStatus,
} from "@/components/document-chips";
import { IndexEmptyState, IndexRow } from "@/components/index-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { api } from "@/convex/_generated/api";
import { dateTime } from "@/lib/utils";

type Filter = "all" | DocumentStatus;

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  ...(Object.keys(documentStatusLabels) as DocumentStatus[]).map((status) => ({
    value: status,
    label: documentStatusLabels[status],
  })),
];

// Every uploaded PDF across every customer, newest first. Search reads the
// title and the customer's name.
export function DocumentsIndex() {
  const documents = useQuery(api.documents.list);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [uploading, setUploading] = useState(false);
  const query = search.trim().toLowerCase();
  const shown = documents?.filter(
    (d) =>
      (filter === "all" || d.status === filter) &&
      `${d.title} ${d.customerName}`.toLowerCase().includes(query),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative block w-full max-w-md">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title or customer"
            aria-label="Search documents"
            className="h-9 pl-8"
          />
        </label>
        <Button size="lg" onClick={() => setUploading(true)}>
          <Upload data-icon="inline-start" aria-hidden />
          Upload PDF
        </Button>
      </div>
      <div className="no-scrollbar max-w-full overflow-x-auto [&_button]:whitespace-nowrap">
        <Segmented label="Status" value={filter} onChange={setFilter} options={filters} />
      </div>

      {shown === undefined ? (
        <div className="grid min-h-64 place-items-center rounded-2xl border bg-white">
          <LoaderCircle aria-label="Loading documents" className="size-6 animate-spin text-slate-500" />
        </div>
      ) : shown.length === 0 ? (
        <IndexEmptyState
          icon={FileText}
          title={documents?.length ? "No document matches that" : "No documents yet"}
        >
          {documents?.length
            ? "Try a different search or status."
            : "Upload a PDF, place the signature, and send your customer a link."}
        </IndexEmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
          {shown.map((d) => (
            <IndexRow
              key={d._id}
              href={`/documents/${d._id}`}
              title={d.title}
              subtitle={[
                d.customerName,
                d.lastViewedAt
                  ? `Last viewed ${dateTime(d.lastViewedAt)}`
                  : `Created ${new Date(d._creationTime).toLocaleDateString()}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              hint={<DocumentStatusChip status={d.status} />}
            />
          ))}
        </ul>
      )}

      {uploading ? <UploadPdfDialog onClose={() => setUploading(false)} /> : null}
    </div>
  );
}
