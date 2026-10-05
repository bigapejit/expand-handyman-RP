import { DocumentEditor } from "@/components/document-editor";
import type { Id } from "@/convex/_generated/dataModel";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DocumentEditor id={id as Id<"documents">} />;
}
