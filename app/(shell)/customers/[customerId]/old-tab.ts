import { redirect } from "next/navigation";

// The customer page had a tab per route under it; it has none now, and the
// work lives on each Site's page. An old tab's link, bookmarked or copied,
// lands on the customer page itself.
export default async function OldCustomerTab({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  redirect(`/customers/${customerId}`);
}
