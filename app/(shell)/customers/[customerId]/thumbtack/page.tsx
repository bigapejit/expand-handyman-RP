import { CustomerThumbtack } from "@/components/customer-thumbtack";

export default async function Page({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return <CustomerThumbtack customerId={customerId} />;
}
