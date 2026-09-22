import { redirect } from "next/navigation";

// Proposals is the customer's landing tab (#14).
export default async function CustomerPage({
  params,
}: PageProps<"/customers/[customerId]">) {
  const { customerId } = await params;

  redirect(`/customers/${customerId}/proposals`);
}
