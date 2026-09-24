import { redirect } from "next/navigation";

// Proposals is the site's landing tab.
export default async function SitePage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  redirect(`/sites/${siteId}/proposals`);
}
