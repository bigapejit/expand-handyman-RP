import { CustomerPage } from "@/components/customer-page";

export default async function Page({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return <CustomerPage customerId={customerId} />;
}
