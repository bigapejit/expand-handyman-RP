import { ThinCustomerPage } from "@/components/prototype/thin-customer-page";

// PROTOTYPE (#90): the customer page is thin and has no tabs, so the layout
// renders it whole and the old tab routes under it show the same page.
export default async function CustomerLayout({
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return <ThinCustomerPage customerId={customerId} />;
}
