import type { Metadata } from "next";

import { StaffInvoicePaper } from "@/components/staff-invoice-paper";
import type { Id } from "@/convex/_generated/dataModel";

export const metadata: Metadata = {
  title: "Invoice paper · Expand Handyman",
};

export default async function Page({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  return <StaffInvoicePaper invoiceId={invoiceId as Id<"invoices">} />;
}
