"use client";

// PROTOTYPE (wayfinder ticket #21): the customer's uploaded PDFs, real data,
// on FRSG's IndexRow. "Upload PDF" is drawn but does nothing here.
import { useConvexAuth, useQuery } from "convex/react";
import { FileText, LoaderCircle, Upload } from "lucide-react";

import { Status } from "@/components/dashboard";
import { IndexRow } from "@/components/index-row";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { shortDate } from "@/lib/prototype-hub";

export function CustomerDocuments({ customerId }: { customerId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const documents = useQuery(api.documents.list, isAuthenticated ? {} : "skip");
  const mine = documents?.filter((d) => d.customerId === customerId);

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-950">Documents</h2>
          <p className="mt-1 text-sm text-slate-500">Uploaded PDFs sent for a signature.</p>
        </div>
        <Button variant="outline" size="lg">
          <Upload data-icon="inline-start" aria-hidden /> Upload PDF
        </Button>
      </header>
      {mine === undefined ? (
        <div className="grid min-h-40 place-items-center">
          <LoaderCircle aria-label="Loading documents" className="size-6 animate-spin text-slate-500" />
        </div>
      ) : mine.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500">
          <FileText aria-hidden className="size-4" /> No documents for this customer yet.
        </p>
      ) : (
        <ul className="divide-y">
          {mine.map((d) => (
            <IndexRow
              key={d._id}
              href={`/documents/${d._id}`}
              title={d.title}
              subtitle={d.issuedAt ? `Issued ${shortDate(d.issuedAt)}` : `Created ${shortDate(d._creationTime)}`}
              hint={<Status status={d.status} />}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
