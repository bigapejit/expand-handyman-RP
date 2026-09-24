import { Suspense } from "react";

import { SiteHubShell } from "@/components/prototype/site-hub-shell";

// PROTOTYPE (#90): the site page. Header and tabs live in the layout, as on
// the customer page; each tab is its own route.
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  return (
    <Suspense>
      <SiteHubShell siteId={siteId}>{children}</SiteHubShell>
    </Suspense>
  );
}
