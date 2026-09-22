// PROTOTYPE (wayfinder ticket #21): made-up Sites, Solutions and Proposals
// hung off the real customers, because none of those tables exist yet. The
// customer's own name, email and phone are real; everything here is fiction,
// seeded from the customer id so a reload shows the same thing.

export type ProposalState = "draft" | "sent" | "approved" | "declined";

export function proposalStateLabel(state: ProposalState): string {
  switch (state) {
    case "draft":
      return "Draft";
    case "sent":
      return "Sent";
    case "approved":
      return "Approved";
    case "declined":
      return "Declined";
  }
}

export type StubSite = { siteId: string; name: string; address: string };
export type StubSolution = {
  solutionId: string;
  siteId: string;
  title: string;
  lineCount: number;
  priceCents: number | null;
};
export type StubProposal = {
  proposalId: string;
  siteId: string;
  number: number;
  title: string;
  state: ProposalState;
  recommended: boolean;
  solutionIds: string[];
  notes: string;
  sentAt: number | null;
  openedAt: number | null;
  decidedAt: number | null;
  depositPercent: number;
};

export type StubCustomer = {
  _id: string;
  name: string;
  email: string;
  phone: string;
  site: string;
};

function seed(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

// Site name: FRSG's createSiteName (convex/siteNames.ts) verbatim: the first
// two words of the street line, letters and digits only, upper-cased.
export function siteName(address: string): string {
  const line1 = address.split(",")[0] ?? address;
  const tokens = line1.trim().split(/\s+/).filter(Boolean);
  const norm = (v: string) => v.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `${norm(tokens[0] ?? "")}${norm(tokens[1] ?? "")}` || norm(line1);
}

const ExtraAddresses = [
  "1802 Main St, Vancouver, WA 98660",
  "9311 NE 72nd Ave, Vancouver, WA 98665",
  "400 E Mill Plain Blvd, Vancouver, WA 98660",
];

export function stubSites(customer: StubCustomer): StubSite[] {
  const s = seed(customer._id);
  const first = customer.site?.trim() || "12 Oak Street, Vancouver, WA 98661";
  const sites = [{ siteId: `${customer._id}-s1`, name: siteName(first), address: first }];
  if (s % 3 !== 0) {
    const second = ExtraAddresses[s % ExtraAddresses.length];
    sites.push({ siteId: `${customer._id}-s2`, name: siteName(second), address: second });
  }
  return sites;
}

const SolutionTitles = [
  ["Replace rotted deck boards", 6, 184500],
  ["Rebuild stair railing to code", 4, 96000],
  ["Bathroom exhaust fan replacement", 3, 42500],
  ["Patch and paint hallway drywall", 5, 67500],
  ["Gutter clean and downspout reset", 2, 32000],
  ["Install exterior motion lights", 3, null],
] as const;

export function stubSolutions(customer: StubCustomer): StubSolution[] {
  const sites = stubSites(customer);
  return SolutionTitles.map(([title, lineCount, priceCents], i) => ({
    solutionId: `${customer._id}-sol${i + 1}`,
    siteId: sites[i % sites.length].siteId,
    title,
    lineCount,
    priceCents,
  }));
}

const Day = 86_400_000;
const Now = Date.UTC(2026, 8, 22, 18);

export function stubProposals(customer: StubCustomer): StubProposal[] {
  const s = seed(customer._id);
  const sites = stubSites(customer);
  const sols = stubSolutions(customer);
  const on = (site: StubSite) => sols.filter((x) => x.siteId === site.siteId).map((x) => x.solutionId);
  const a = sites[0];
  const b = sites[1] ?? sites[0];
  const all: StubProposal[] = [
    {
      proposalId: `${customer._id}-p1`,
      siteId: a.siteId,
      number: 1,
      title: "Deck and stairs",
      state: s % 4 === 0 ? "draft" : "sent",
      recommended: true,
      solutionIds: on(a).slice(0, 2),
      notes: "Excludes staining. Work scheduled within two weeks of approval.",
      sentAt: s % 4 === 0 ? null : Now - 5 * Day,
      openedAt: s % 4 !== 0 && s % 2 ? Now - 3 * Day : null,
      decidedAt: null,
      depositPercent: 50,
    },
    {
      proposalId: `${customer._id}-p2`,
      siteId: a.siteId,
      number: 2,
      title: "Deck boards only",
      state: "draft",
      recommended: false,
      solutionIds: on(a).slice(0, 1),
      notes: "",
      sentAt: null,
      openedAt: null,
      decidedAt: null,
      depositPercent: 50,
    },
    {
      proposalId: `${customer._id}-p3`,
      siteId: b.siteId,
      number: b === a ? 3 : 1,
      title: "Interior touch-ups",
      state: s % 2 ? "approved" : "declined",
      recommended: false,
      solutionIds: on(b).slice(-2),
      notes: "",
      sentAt: Now - 20 * Day,
      openedAt: Now - 19 * Day,
      decidedAt: Now - 18 * Day,
      depositPercent: 30,
    },
  ];
  // A third of customers have no proposals at all, so the index shows the quiet hint.
  return s % 3 === 1 ? [] : all;
}

export const TaxRate = 8.7;

export function proposalMoney(customer: StubCustomer, proposal: StubProposal) {
  const sols = stubSolutions(customer).filter((x) => proposal.solutionIds.includes(x.solutionId));
  const subtotalCents = sols.reduce((sum, x) => sum + (x.priceCents ?? 0), 0);
  const taxCents = Math.round((subtotalCents * TaxRate) / 100);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

export function proposalId(sites: StubSite[], proposal: StubProposal): string {
  const site = sites.find((x) => x.siteId === proposal.siteId);
  return `${site?.name ?? "SITE"}-P${proposal.number}`;
}

// The Customers-index hint (#14): what is waiting, else the last outcome, else quiet.
export function customerHint(
  customer: StubCustomer,
): { kind: "awaiting"; count: number } | { kind: "outcome"; state: ProposalState } | { kind: "none" } {
  const proposals = stubProposals(customer);
  const awaiting = proposals.filter((p) => p.state === "sent").length;
  if (awaiting > 0) return { kind: "awaiting", count: awaiting };
  const decided = proposals.filter((p) => p.decidedAt !== null);
  if (decided.length > 0) return { kind: "outcome", state: decided[0].state };
  return { kind: "none" };
}
