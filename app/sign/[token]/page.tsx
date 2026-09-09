import { SigningPage } from "@/components/signing-page";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SigningPage token={token} />;
}
