import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { ThumbtackBoardPage } from "@/components/thumbtack-page";

export default function ThumbtackPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Thumbtack"
        description="Leads from Thumbtack, newest first. Chat is read-only here; reply on Thumbtack."
      />
      <Suspense>
        <ThumbtackBoardPage />
      </Suspense>
    </div>
  );
}
