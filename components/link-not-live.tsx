// What a signing or invoice link says once it opens nothing: withdrawn,
// replaced by a re-send, or never a link at all (`unknown`). It never says
// why: that is Expand's to tell the customer, not a URL's.
export function LinkNotLive({ what }: { what: "proposal" | "invoice" | "unknown" }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-3 px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">
        Expand Handyman
      </p>
      <h1 className="text-2xl font-semibold text-stone-950">
        This link is no longer live
      </h1>
      <p className="text-sm leading-relaxed text-stone-600">
        {what === "invoice"
          ? "Contact Expand Handyman for a current link to this invoice."
          : what === "proposal"
            ? "The proposal it opened is no longer waiting on your answer. Contact Expand Handyman for a current link."
            : "Contact Expand Handyman for a current link."}
      </p>
    </main>
  );
}
