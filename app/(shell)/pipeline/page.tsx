import { redirect } from "next/navigation";

import { DealPanelParam, dealPanelHref } from "@/lib/pipeline";

// The Pipeline is the home page now. An old link to it, bookmarked or copied,
// lands there, still opening the deal it named.
export default async function OldPipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const deal = (await searchParams)[DealPanelParam];
  redirect(typeof deal === "string" ? dealPanelHref(deal) : "/");
}
