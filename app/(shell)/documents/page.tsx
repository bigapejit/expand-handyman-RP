import { DocumentsIndex } from "@/components/documents-index";
import { PageHeader } from "@/components/page-header";

export default function DocumentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Uploaded PDFs, prepared for a customer to review and sign."
      />
      <DocumentsIndex />
    </div>
  );
}
