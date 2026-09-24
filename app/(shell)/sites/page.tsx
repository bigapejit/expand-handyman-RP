import { PageHeader } from "@/components/page-header";
import { SitesIndex } from "@/components/sites-index";

export default function SitesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sites"
        description="Every place you work, most recent first. Open one for its proposals, solutions and photos."
      />
      <SitesIndex />
    </div>
  );
}
