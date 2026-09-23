import { SignRoute } from "@/components/sign-route";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SignRoute token={token} />;
}
