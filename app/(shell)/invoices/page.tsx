import { InvoicesIndex, ZelleSetting } from "@/components/invoices-index";
import { PageHeader } from "@/components/page-header";

export default function InvoicesPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <PageHeader title="Invoices" description="Every invoice across every customer." />
        <ZelleSetting />
      </div>
      <InvoicesIndex />
    </div>
  );
}
