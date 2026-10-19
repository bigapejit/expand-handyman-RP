import { JobMathPage } from "@/components/job-math-page";
import { PageHeader } from "@/components/page-header";

// A query param, read as the one string a field can start from.
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

// The calculator, opened blank or with a job's figures in the query
// (`?price=350&hours=8&other=0&wage=30`, in dollars), which is how the Solution
// panel links in.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const initial = {
    price: one(query.price),
    hours: one(query.hours),
    other: one(query.other),
    wage: one(query.wage),
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Job math"
        description="What a job leaves you, and what it could pay a helper. Nothing here changes a price."
      />
      {/* Keyed on the figures so following another link in starts the fields
          over from it, rather than keeping what the last job typed. */}
      <JobMathPage key={JSON.stringify(initial)} initial={initial} />
    </div>
  );
}
