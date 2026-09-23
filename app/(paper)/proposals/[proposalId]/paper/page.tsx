import { StaffPaper } from "@/components/staff-paper";
import type { Id } from "@/convex/_generated/dataModel";

export default async function Page({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;
  return <StaffPaper proposalId={proposalId as Id<"proposals">} />;
}
