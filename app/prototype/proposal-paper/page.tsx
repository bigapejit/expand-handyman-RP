// PROTOTYPE (issue #22): throwaway. Four states of the Expand proposal paper,
// switchable via `?variant=` (sent, small, approved, preview). Run `npm run dev`
// and open http://localhost:3210/prototype/proposal-paper
import { PaperPrototype } from "@/components/prototype-proposal-paper/paper-prototype";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { variant } = await searchParams;
  return <PaperPrototype variant={typeof variant === "string" ? variant : "sent"} />;
}
