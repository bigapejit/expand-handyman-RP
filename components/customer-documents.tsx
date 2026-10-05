"use client";

import { useQuery } from "convex/react";
import { Upload } from "lucide-react";
import { useState } from "react";

import { HubEmpty, HubLoading, HubSection } from "@/components/hub-section";
import { DocumentStatusChip } from "@/components/document-chips";
import { UploadPdfDialog } from "@/components/document-dialogs";
import { IndexRow } from "@/components/index-row";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// The customer's uploaded PDFs. Upload PDF here already knows whose they are.
export function CustomerDocuments({ customerId }: { customerId: string }) {
  const documents = useQuery(api.documents.forCustomer, {
    customerId: customerId as Id<"customers">,
  });
  const [uploading, setUploading] = useState(false);

  return (
    <HubSection
      title="Documents"
      description="Uploaded PDFs sent for a signature."
      action={
        <Button variant="outline" size="lg" onClick={() => setUploading(true)}>
          <Upload data-icon="inline-start" aria-hidden /> Upload PDF
        </Button>
      }
    >
      {documents === undefined ? (
        <HubLoading label="Loading documents" />
      ) : documents.length === 0 ? (
        <HubEmpty>No documents for this customer yet.</HubEmpty>
      ) : (
        <ul className="divide-y">
          {documents.map((d) => (
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
      {uploading ? (
        <UploadPdfDialog customerId={customerId} onClose={() => setUploading(false)} />
      ) : null}
    </HubSection>
  );
}
