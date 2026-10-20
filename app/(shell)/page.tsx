import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { PipelinePage } from "@/components/pipeline-page";

// Home is the **Pipeline**: every job the owner is chasing, Thumbtack leads
// included, from first contact to won. A deal's proposal opens on its own
// page from the deal's panel.
export default function HomePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pipeline"
        description="Every job you are chasing, from first contact to won. Thumbtack leads arrive in New on their own."
      />
      <Suspense>
        <PipelinePage />
      </Suspense>
    </div>
  );
}
