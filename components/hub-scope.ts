import type { Id } from "@/convex/_generated/dataModel";

// Which page a Proposals, Solutions or Invoices tab sits on: one Site's page,
// or the Customer's page across all their sites. On a site the tab reads its
// site-scoped query, leaves the site tag off its rows, and makes new work for
// that site with no picker. The customer's scope goes once the customer page
// thins to contact details, site cards and Documents.
export type HubScope =
  | { siteId: Id<"sites">; customerId?: never }
  | { customerId: Id<"customers">; siteId?: never };
