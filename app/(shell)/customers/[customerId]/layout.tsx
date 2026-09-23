import { CustomerHubShell } from "@/components/customer-hub-shell";

// The header and the tab row live in the layout so switching tabs never
// re-renders them, and a tab's own page is only ever the content area.
export default async function CustomerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return <CustomerHubShell customerId={customerId}>{children}</CustomerHubShell>;
}
