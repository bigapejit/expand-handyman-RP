import { InvoicesIndex } from "@/components/invoices-index";
import { PageHeader } from "@/components/page-header";
import { ZelleSetting } from "@/components/zelle-setting";

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
