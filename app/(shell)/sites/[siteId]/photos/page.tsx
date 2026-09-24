import { SitePhotos } from "@/components/prototype/site-photos";

export default async function Page({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  return <SitePhotos siteId={siteId} />;
}
