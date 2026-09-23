// PROTOTYPE (issue #68): throwaway. Four states of the invoice paper,
// switchable via `?variant=` (deposit, final, paid, void). Run `npm run dev`
// and open http://localhost:3210/prototype/invoice-paper
import { InvoicePrototype } from "@/components/prototype-invoice-paper/invoice-prototype";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { variant } = await searchParams;
  return <InvoicePrototype variant={typeof variant === "string" ? variant : "deposit"} />;
}
