// Money, in the one form Expand reads it. Every figure in the app is stored in
// whole cents and shown in dollars, and this is the only place that conversion
// happens — the staff console, the proposal paper, and the email a
// customer opens all have to name the same figure the same way.

// A whole-dollar price drops its ".00" so a list of figures stays calm; a
// figure with cents keeps both places.
export function formatCents(cents: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

// The same figure on paper a customer signs. Every place is kept, whole
// dollars and all: the Proposal Document's figures sit in a column that has
// to line up, and "$7,623.00" cannot be misread as a figure someone rounded
// on the way to the page.
export function formatCentsExact(cents: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}
