import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { PipelinePrototype } from "@/components/pipeline-prototype/pipeline-prototype";

// PROTOTYPE route. Three layouts for the Pipeline (the Thumbtack page grown to
// every deal), switched with ?variant=A|B|C. See components/pipeline-prototype.
export default function PipelinePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pipeline"
        description="Every job you are chasing, from first contact to won. Thumbtack leads arrive in New on their own."
      />
      <Suspense>
        <PipelinePrototype />
      </Suspense>
    </div>
  );
}
