import { SiteHubShell } from "@/components/site-hub-shell";

// The header and the tab row live in the layout so switching tabs never
// re-renders them, and a tab's own page is only ever the content area.
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  return <SiteHubShell siteId={siteId}>{children}</SiteHubShell>;
}
