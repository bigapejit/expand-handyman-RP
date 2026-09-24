import { Suspense } from "react";

import { SiteTab } from "@/components/prototype/site-tab";

export default async function Page({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  return (
    <Suspense>
      <SiteTab siteId={siteId} tab="solutions" />
    </Suspense>
  );
}
