"use client";

import { useQuery } from "convex/react";
import { FileText, LoaderCircle, Upload, Users } from "lucide-react";
import { useState } from "react";

import { UploadPdfDialog } from "@/components/document-dialogs";
import { DocumentStatusChip } from "@/components/document-chips";
import { IndexEmptyState, IndexRow } from "@/components/index-row";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { displayPhone } from "@/lib/customer";

// One customer: who they are and their documents. The tabbed hub with Sites,
// Solutions and Proposals replaces this.
export function CustomerPage({ customerId }: { customerId: string }) {
  const customers = useQuery(api.documents.customers);
  const customer = customers?.find((c) => c._id === customerId);
  const theirs = useQuery(
    api.documents.forCustomer,
    customer ? { customerId: customer._id } : "skip",
  );
  const [uploading, setUploading] = useState(false);

  if (customers === undefined)
    return (
      <div className="grid min-h-64 place-items-center">
        <LoaderCircle aria-label="Loading customer" className="size-6 animate-spin text-slate-500" />
      </div>
    );
  if (!customer)
    return (
      <IndexEmptyState icon={Users} title="Customer not found">
        They may have been removed. Pick one from the Customers list.
      </IndexEmptyState>
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name}
        description={[customer.email, displayPhone(customer.phone), customer.site]
          .filter(Boolean)
          .join(" · ")}
      />
      <section aria-labelledby="customer-documents-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="customer-documents-heading"
            className="text-lg font-semibold tracking-tight"
          >
            Documents
          </h2>
          <Button onClick={() => setUploading(true)}>
            <Upload data-icon="inline-start" aria-hidden />
            Upload PDF
          </Button>
        </div>
        {theirs === undefined ? (
          <div className="grid min-h-32 place-items-center rounded-2xl border bg-white">
            <LoaderCircle aria-label="Loading documents" className="size-5 animate-spin text-slate-500" />
          </div>
        ) : theirs.length === 0 ? (
          <IndexEmptyState icon={FileText} title="No documents yet">
            Upload a PDF to prepare it for {customer.name} to sign.
          </IndexEmptyState>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-white">
            {theirs.map((d) => (
              <IndexRow
                key={d._id}
                href={`/documents/${d._id}`}
                title={d.title}
                subtitle={`Created ${new Date(d._creationTime).toLocaleDateString()}`}
                hint={<DocumentStatusChip status={d.status} />}
              />
            ))}
          </ul>
        )}
      </section>
      {uploading ? (
        <UploadPdfDialog customerId={customerId} onClose={() => setUploading(false)} />
      ) : null}
    </div>
  );
}
