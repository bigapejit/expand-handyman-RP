import { redirect } from "next/navigation";

// Proposals is the customer's landing tab.
export default async function CustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  redirect(`/customers/${customerId}/proposals`);
}
