import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { PipelinePage } from "@/components/pipeline-page";

export default function Pipeline() {
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
