import { StaffShell } from "@/components/staff-shell";
import { DocumentEditor } from "@/components/document-editor";
import type { Id } from "@/convex/_generated/dataModel";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <StaffShell>
      <DocumentEditor id={id as Id<"documents">} />
    </StaffShell>
  );
}
