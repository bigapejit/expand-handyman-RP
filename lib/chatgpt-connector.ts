// The **ChatGPT connector**'s tools (CONTEXT.md): what ChatGPT may read and
// write in the staff app while the owner estimates by chatting with it.
//
// The set is small on purpose. ChatGPT can find customers, sites and
// proposals, add a customer and a site, write Solutions, assemble a draft
// Proposal and run Job math. Sending, withdrawing, deleting, payments and
// invoices stay in the app: nothing here can reach a customer or move money.
//
// Every tool calls the same public Convex functions the browser does, through
// an injected caller holding the staff member's own identity, so
// `requireOwner` guards each call and every refusal is the app's own
// sentence. That injection is also what lets the tools be tested without
// HTTP, OAuth or a deployment (lib/chatgpt-connector.test.ts).
//
// Money crosses the tool boundary in dollars, because that is how the owner
// says it and how ChatGPT reads it, and is whole cents everywhere inside, as
// in the rest of the app. Only `centsFrom` and `dollarsOf` convert.

import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";
import { z } from "zod";

import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { contactWarnings, displayPhone, findCustomers } from "./customer";
import {
  jobMath,
  jobMathHref,
  solutionJobInputs,
  type JobMathSettings,
} from "./job-math";
import { LineItemUnits } from "./line-item-units";
import type { PlaceSuggestion } from "./places";
import {
  depositPercentFault,
  proposalFaultMessage,
  sendBlockerMessage,
} from "./proposal-pricing";
import { proposalPanelHref, proposalPaperHref, type ProposalState } from "./proposals";
import { panelHref } from "./side-panel";
import {
  lineCostCents,
  lineItemFault,
  lineItemFaultMessage,
  markupFaultMessage,
  markupPercentFault,
  materialAllowanceFault,
  materialAllowanceFaultMessage,
  type SolutionLineItem,
} from "./solution-pricing";
import { errorMessage } from "./utils";

// ---------------------------------------------------------------------------
// What a tool is handed.

// The three ways to call Convex, shaped like ConvexHttpClient's own methods
// so the route passes one straight in and a test passes a fake.
export type ConvexCaller = {
  query<Q extends FunctionReference<"query">>(
    query: Q,
    ...args: OptionalRestArgs<Q>
  ): Promise<FunctionReturnType<Q>>;
  mutation<M extends FunctionReference<"mutation">>(
    mutation: M,
    ...args: OptionalRestArgs<M>
  ): Promise<FunctionReturnType<M>>;
  action<A extends FunctionReference<"action">>(
    action: A,
    ...args: OptionalRestArgs<A>
  ): Promise<FunctionReturnType<A>>;
};

export type ToolContext = {
  convex: ConvexCaller;
  // The app's public origin, which every link a tool returns starts with.
  origin: string;
  // A fresh Places session token; Google bills a lookup and the save that
  // closes it as one session.
  newSessionToken?: () => string;
};

// The hints ChatGPT reads to decide what to confirm with the owner first. It
// asks for every one of the three, so every tool names them all.
type Annotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
  idempotentHint?: boolean;
};

const Reads: Annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
};
// Adds a row and changes nothing already there.
const Adds: Annotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: false,
};

export type ConnectorTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  annotations: Annotations;
  run(args: never, context: ToolContext): Promise<ToolOutput>;
};

export type ToolOutput = Record<string, unknown>;

function defineTool<S extends z.ZodObject>(tool: {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  annotations: Annotations;
  run(args: z.output<S>, context: ToolContext): Promise<ToolOutput>;
}): ConnectorTool {
  return tool as unknown as ConnectorTool;
}

// ---------------------------------------------------------------------------
// Refusals.

// A refusal worded for the owner, raised by a tool before anything is asked
// of Convex. Convex's own refusals arrive as its errors and are read the way
// the staff app reads them (lib/utils.ts, `errorMessage`).
export class ToolRefusal extends Error {}

// The sentence ChatGPT gets back when a call is refused. An id that is not
// one Convex gave out fails its argument validator with a paragraph about
// validators; ChatGPT can do something with "look it up" instead.
export function refusalMessage(error: unknown): string {
  const message = errorMessage(error);
  if (/ArgumentValidationError|does not match validator/.test(message))
    return "One of the ids given is not one the app gave out. Look it up again with find_customers, get_site or list_proposals, and use the id exactly as returned.";
  return message;
}

// The result of one call, as the route hands it to ChatGPT: what the tool
// returned, or the refusal in one sentence. Arguments are read through the
// tool's own schema here too, so a test calling a tool directly is refused
// exactly as ChatGPT would be.
export async function callTool(
  tool: ConnectorTool,
  args: unknown,
  context: ToolContext,
): Promise<{ ok: true; output: ToolOutput } | { ok: false; message: string }> {
  const parsed = tool.inputSchema.safeParse(args ?? {});
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues.map((issue) => issueText(issue)).join(" ") };
  try {
    return { ok: true, output: await tool.run(parsed.data as never, context) };
  } catch (error) {
    return { ok: false, message: refusalMessage(error) };
  }
}

function issueText(issue: z.core.$ZodIssue): string {
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}.` : `${issue.message}.`;
}

// ---------------------------------------------------------------------------
// Dollars and cents.

// Dollars as ChatGPT sends them, as whole cents. A figure finer than a cent is
// refused rather than rounded, so what is stored is what the owner said.
export function centsFrom(dollars: number, what: string): number {
  const cents = dollars * 100;
  if (!Number.isFinite(dollars) || Math.abs(cents - Math.round(cents)) > 1e-6)
    throw new ToolRefusal(`${what} must be dollars and cents, such as 12.50.`);
  return Math.round(cents);
}

// Cents as a tool returns them: dollars, with the cents as decimals.
export function dollarsOf(cents: number): number {
  return cents / 100;
}

function dollarsOrNull(cents: number | null | undefined): number | null {
  return cents === null || cents === undefined ? null : dollarsOf(cents);
}

// ---------------------------------------------------------------------------
// Links. Each points where the owner works on the thing in the app.

function link(context: ToolContext, path: string): string {
  return `${context.origin}${path}`;
}

const customerHref = (customerId: string) => `/customers/${customerId}`;
const siteHref = (siteId: string) => `/sites/${siteId}`;
const solutionHref = (siteId: string, solutionId: string) =>
  panelHref(`/sites/${siteId}/solutions`, "", "solution", solutionId);

// ---------------------------------------------------------------------------
// Shapes the tools return.

type OwnerSolution = NonNullable<FunctionReturnType<typeof api.solutions.get>>;
type OwnerProposal = FunctionReturnType<typeof api.proposals.forSite>["proposals"][number];

// **Job math** for a solution in one line, as the Solution panel shows it
// under the price (components/site-solutions.tsx): whole dollars an hour, the
// take-home to the nearest and the most it can pay rounded down, so the line
// never promises a wage the job can't cover.
export function jobMathLine(
  solution: OwnerSolution,
  settings: JobMathSettings,
): string | null {
  const inputs = solutionJobInputs({
    lineItems: solution.lineItems,
    markupPercent: solution.markupPercent,
    materialAllowanceCents: solution.materialAllowanceCents ?? undefined,
  });
  if (inputs === null) return null;
  if (inputs.laborHours <= 0) return "No hour (HR) lines, so no per-hour figures.";
  const { owner, w2 } = jobMath(inputs, settings);
  const keep = Math.round((owner.takeHomePerHourCents ?? 0) / 100);
  const maxWage = Math.floor((w2.maxWageCents ?? 0) / 100);
  return `You keep about $${keep}/hr doing it yourself; ${
    maxWage > 0 ? `it can pay a W-2 worker up to $${maxWage}/hr` : "it can't pay a W-2 worker"
  }.`;
}

function solutionOut(
  solution: OwnerSolution,
  context: ToolContext,
  settings: JobMathSettings | null,
) {
  return {
    solution_id: solution._id,
    site_id: solution.siteId,
    title: solution.title,
    scope_of_work: solution.description,
    line_items: solution.lineItems.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unit: line.unit,
      unit_cost_dollars: dollarsOf(line.unitCostCents),
      line_cost_dollars: dollarsOf(lineCostCents(line)),
    })),
    markup_percent: solution.markupPercent,
    material_allowance_dollars: dollarsOrNull(solution.materialAllowanceCents),
    // What the line items cost the owner, and what the customer pays; both
    // null while the solution has no price, which is not a price of $0.
    cost_dollars: dollarsOrNull(solution.price?.costCents),
    price_dollars: dollarsOrNull(solution.price?.priceCents),
    job_math: settings ? jobMathLine(solution, settings) : null,
    link: link(context, solutionHref(solution.siteId, solution._id)),
  };
}

function proposalOut(proposal: OwnerProposal, context: ToolContext) {
  const { deposit } = proposal.payment;
  return {
    proposal_id: proposal.proposalId,
    proposal_code: proposal.code,
    title: proposal.title,
    state: proposal.state,
    recommended: proposal.recommended,
    solutions: proposal.solutions.map((solution) => ({
      solution_id: solution.solutionId,
      title: solution.title,
      price_dollars: dollarsOrNull(solution.priceCents),
    })),
    subtotal_dollars: dollarsOf(proposal.money.subtotalCents),
    // A decimal of the whole (0.089 is 8.9%); null when the site charges no
    // sales tax or its rate is not known yet.
    tax_rate: proposal.tax.source === "none" ? null : (proposal.tax.rate ?? null),
    tax_dollars: dollarsOf(proposal.money.taxCents),
    total_dollars: dollarsOf(proposal.money.totalCents),
    deposit:
      deposit.kind === "percent"
        ? { percent: deposit.percent, dollars: dollarsOf(proposal.payment.depositCents) }
        : { set_amount_dollars: dollarsOf(deposit.cents), dollars: dollarsOf(deposit.cents) },
    balance_dollars: dollarsOf(proposal.payment.balanceCents),
    notes: proposal.notes,
    // What the owner must fix before sending it from the app.
    send_blockers: proposal.sendBlockers.map(sendBlockerMessage),
    link: link(context, proposalPanelHref(proposal.siteId, proposal.proposalId)),
    paper_link: link(context, proposalPaperHref(proposal.proposalId)),
  };
}

// ---------------------------------------------------------------------------
// Line items and the other typed figures, read and refused before anything
// is written, so a refused figure never leaves a half-made solution behind.

const lineItemInput = z.object({
  name: z.string().describe("What the line is, as the customer will read it."),
  quantity: z.number().min(0).describe("How many units. May have decimals, such as 1.5."),
  unit: z
    .enum(LineItemUnits)
    .optional()
    .describe(
      "EA each (the default), SF square feet, LF linear feet, HR hours, DA days, WK weeks. Hours of work go on HR lines; Job math counts only those as labor.",
    ),
  unit_cost_dollars: z
    .number()
    .min(0)
    .describe("What one unit costs the owner, in dollars, not what the customer pays."),
});

const solutionFields = {
  scope_of_work: z
    .string()
    .optional()
    .describe("The Scope of Work: what the job includes, in plain sentences the customer reads."),
  line_items: z
    .array(lineItemInput)
    .optional()
    .describe("The solution's line items. When given, they replace every line item it had."),
  markup_percent: z
    .number()
    .optional()
    .describe("Whole percent added to the line items' cost to reach the price. 10 unless the owner says otherwise."),
};

function storedLineItems(lines: z.output<typeof lineItemInput>[] | undefined) {
  if (lines === undefined) return undefined;
  return lines.map((line, index): SolutionLineItem => {
    const stored = {
      name: line.name.trim(),
      quantity: line.quantity,
      unit: line.unit ?? "EA",
      unitCostCents: centsFrom(line.unit_cost_dollars, `Line ${index + 1}'s unit cost`),
    };
    const fault = lineItemFault(stored);
    if (fault) throw new ToolRefusal(`Line ${index + 1}: ${lineItemFaultMessage(fault)}`);
    return stored;
  });
}

function checkedMarkup(markup: number | undefined) {
  if (markup === undefined) return undefined;
  const fault = markupPercentFault(markup);
  if (fault) throw new ToolRefusal(markupFaultMessage(fault));
  return markup;
}

function allowanceCents(dollars: number | null | undefined) {
  if (dollars === undefined || dollars === null) return dollars;
  const cents = centsFrom(dollars, "The material allowance");
  const fault = materialAllowanceFault(cents);
  if (fault) throw new ToolRefusal(materialAllowanceFaultMessage(fault));
  return cents;
}

// ---------------------------------------------------------------------------
// Reading through Convex.

async function jobMathSettings(context: ToolContext): Promise<JobMathSettings> {
  return (await context.convex.query(api.settings.get)).jobMath;
}

async function requireSite(context: ToolContext, siteId: string) {
  const site = await context.convex.query(api.sites.get, { siteId: siteId.trim() });
  if (!site)
    throw new ToolRefusal(
      `No site has the id ${siteId}. Find the customer with find_customers to see their sites.`,
    );
  return site;
}

async function requireSolution(context: ToolContext, solutionId: string) {
  const solution = await context.convex.query(api.solutions.get, {
    solutionId: solutionId.trim(),
  });
  if (!solution)
    throw new ToolRefusal(
      `No solution has the id ${solutionId}. get_site lists a site's solutions.`,
    );
  return solution;
}

// A proposal named by its Convex id or by its Proposal ID (`1215MAIN-P2`),
// found on the Proposals list and read as its site's Proposals tab reads it.
async function requireProposal(context: ToolContext, named: string) {
  const wanted = named.trim();
  const rows = await context.convex.query(api.proposals.list);
  const row = rows.find(
    (r) => r.proposalId === wanted || r.code.toLowerCase() === wanted.toLowerCase(),
  );
  if (!row)
    throw new ToolRefusal(
      `No proposal is ${named}. list_proposals lists them, with their ids and Proposal IDs.`,
    );
  const atSite = await context.convex.query(api.proposals.forSite, { siteId: row.siteId });
  const proposal = atSite.proposals.find((p) => p.proposalId === row.proposalId);
  if (!proposal) throw new ToolRefusal(`Proposal ${named} could not be read.`);
  return { row, proposal, customerEmail: atSite.customerEmail };
}

async function readProposal(
  context: ToolContext,
  siteId: Id<"sites">,
  proposalId: Id<"proposals">,
) {
  const atSite = await context.convex.query(api.proposals.forSite, { siteId });
  const proposal = atSite.proposals.find((p) => p.proposalId === proposalId);
  if (!proposal) throw new ToolRefusal("The proposal was saved but could not be read back.");
  return proposal;
}

// The ids asked for, each one a solution written for this site, or a refusal
// naming the ones that are not, before anything is written.
async function siteSolutionIds(
  context: ToolContext,
  siteId: Id<"sites">,
  requested: string[],
): Promise<Id<"solutions">[]> {
  const solutions = await context.convex.query(api.solutions.forSite, { siteId });
  const byId = new Map(solutions.map((s) => [s._id as string, s._id]));
  const missing = requested.filter((id) => !byId.has(id.trim()));
  if (missing.length > 0)
    throw new ToolRefusal(
      `These are not solutions at this site: ${missing.join(", ")}. A proposal can only offer solutions written for its own site; get_site lists them.`,
    );
  return [...new Set(requested.map((id) => byId.get(id.trim())!))];
}

// ---------------------------------------------------------------------------
// Picking an address.

export type AddressPick =
  | { kind: "picked"; suggestion: PlaceSuggestion }
  | { kind: "choose"; candidates: PlaceSuggestion[] }
  | { kind: "none" };

function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Which of Google's suggestions a typed address means, without guessing. One
// suggestion is that one. Among several, the one whose street line the typing
// starts with and whose city it names, if only one does; otherwise the owner
// picks, because a site at the wrong address is a proposal sent to the wrong
// house.
export function pickAddress(typed: string, suggestions: PlaceSuggestion[]): AddressPick {
  if (suggestions.length === 0) return { kind: "none" };
  if (suggestions.length === 1) return { kind: "picked", suggestion: suggestions[0] };
  const said = plain(typed);
  const matching = suggestions.filter((s) => {
    const street = plain(s.mainText);
    const city = plain(s.secondaryText.split(",")[0] ?? "");
    return street !== "" && said.startsWith(street) && city !== "" && said.includes(city);
  });
  return matching.length === 1
    ? { kind: "picked", suggestion: matching[0] }
    : { kind: "choose", candidates: suggestions };
}

function suggestionText(s: PlaceSuggestion): string {
  return [s.mainText, s.secondaryText].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// The tools.

const findCustomersTool = defineTool({
  name: "find_customers",
  title: "Find customers",
  description:
    "Search the owner's customers by name, phone number or email. Returns each match with its contact details and its sites (the verified street addresses where work happens), each with an id and a link to open it in the app. Use the site_id with get_site, create_solution or create_proposal.",
  inputSchema: z.object({
    query: z.string().min(1).describe("Part of a name, phone number or email, such as 'maria' or '555 12'."),
    limit: z.number().int().min(1).max(25).optional().describe("Most customers to return. Default 10."),
  }),
  annotations: Reads,
  async run({ query, limit = 10 }, context) {
    const [customers, sites] = await Promise.all([
      context.convex.query(api.customers.list),
      context.convex.query(api.sites.list),
    ]);
    const text = query.trim().toLowerCase();
    const byNameOrPhone = findCustomers(customers, query, customers.length);
    const byEmail =
      text.length >= 3 ? customers.filter((c) => c.email.toLowerCase().includes(text)) : [];
    const matches = [...new Set([...byNameOrPhone, ...byEmail])];
    return {
      customers: matches.slice(0, limit).map((customer) => ({
        customer_id: customer._id,
        name: customer.name,
        email: customer.email || null,
        phone: customer.phone ? displayPhone(customer.phone) : null,
        link: link(context, customerHref(customer._id)),
        sites: sites
          .filter((site) => site.customerId === customer._id)
          .map((site) => ({
            site_id: site.siteId,
            address: [site.streetLine, site.cityLine].filter(Boolean).join(", "),
            proposal_count: site.proposalCount,
            link: link(context, siteHref(site.siteId)),
          })),
      })),
      more_matches: Math.max(0, matches.length - limit),
      ...(matches.length === 0
        ? { message: `No customer matches "${query}". create_customer adds one.` }
        : {}),
    };
  },
});

const ProposalGroups: { key: string; state: ProposalState; label: string }[] = [
  { key: "drafts", state: "draft", label: "Drafts, not yet sent" },
  { key: "sent", state: "sent", label: "Sent, waiting on the customer" },
  { key: "approved", state: "approved", label: "Approved" },
  { key: "declined", state: "declined", label: "Declined" },
];
const ProposalsPerGroup = 25;

const listProposalsTool = defineTool({
  name: "list_proposals",
  title: "List proposals",
  description:
    "List the owner's proposals across every customer, newest first, grouped as drafts, sent (waiting on the customer), approved and declined. Each has its id, its Proposal ID (such as 1215MAIN-P2), the customer, the total in dollars and a link. Pass state to see one group only.",
  inputSchema: z.object({
    state: z
      .enum(["draft", "sent", "approved", "declined"])
      .optional()
      .describe("Only proposals in this state."),
  }),
  annotations: Reads,
  async run({ state }, context) {
    const rows = await context.convex.query(api.proposals.list);
    const groups: Record<string, unknown> = {};
    for (const group of ProposalGroups) {
      if (state && group.state !== state) continue;
      const inGroup = rows.filter((row) => row.state === group.state);
      groups[group.key] = {
        label: group.label,
        count: inGroup.length,
        proposals: inGroup.slice(0, ProposalsPerGroup).map((row) => ({
          proposal_id: row.proposalId,
          proposal_code: row.code,
          title: row.title,
          customer: row.customerName,
          site_id: row.siteId,
          total_dollars: dollarsOf(row.totalCents),
          link: link(context, proposalPanelHref(row.siteId, row.proposalId)),
        })),
      };
    }
    return groups;
  },
});

const getProposalTool = defineTool({
  name: "get_proposal",
  title: "Get a proposal",
  description:
    "Read one proposal in full: its state, its solutions with their line items, costs, markup and prices, the subtotal, sales tax and total, the deposit and balance, its notes, what would stop it being sent, and links to open it and its paper in the app. All money is in dollars. Name it by proposal_id or by its Proposal ID, such as 1215MAIN-P2. Line items are each solution as it stands now; a sent or decided proposal's prices are the ones it was sent with.",
  inputSchema: z.object({
    proposal: z.string().min(1).describe("The proposal_id, or the Proposal ID such as 1215MAIN-P2."),
  }),
  annotations: Reads,
  async run({ proposal: named }, context) {
    const { row, proposal } = await requireProposal(context, named);
    const [site, settings] = await Promise.all([
      context.convex.query(api.sites.get, { siteId: row.siteId }),
      jobMathSettings(context),
    ]);
    const solutions = await context.convex.query(api.solutions.forSite, { siteId: row.siteId });
    const byId = new Map(solutions.map((s) => [s._id as string, s]));
    const out = proposalOut(proposal, context);
    return {
      ...out,
      customer: { customer_id: row.customerId, name: row.customerName },
      site: site
        ? {
            site_id: row.siteId,
            address: [site.streetLine, site.cityLine].filter(Boolean).join(", "),
          }
        : { site_id: row.siteId },
      solutions: proposal.solutions.map((offered) => {
        const live = byId.get(offered.solutionId);
        return {
          ...(live ? solutionOut(live, context, settings) : { solution_id: offered.solutionId }),
          title: offered.title,
          // The price this proposal offers it at.
          price_dollars: dollarsOrNull(offered.priceCents),
        };
      }),
    };
  },
});

const getSiteTool = defineTool({
  name: "get_site",
  title: "Get a site",
  description:
    "Read one site: its address, its customer, access notes, every solution written for it (with line items, prices in dollars and a one-line Job math), and every proposal at it. Use this before writing a proposal, to see which solutions exist.",
  inputSchema: z.object({
    site_id: z.string().min(1).describe("The site's id, from find_customers."),
  }),
  annotations: Reads,
  async run({ site_id }, context) {
    const site = await requireSite(context, site_id);
    const siteId = site.site._id;
    const [solutions, atSite, settings] = await Promise.all([
      context.convex.query(api.solutions.forSite, { siteId }),
      context.convex.query(api.proposals.forSite, { siteId }),
      jobMathSettings(context),
    ]);
    return {
      site_id: siteId,
      site_name: site.site.name,
      address: [site.streetLine, site.cityLine].filter(Boolean).join(", "),
      customer: { customer_id: site.customerId, name: site.customerName },
      customer_email: atSite.customerEmail,
      access_notes: site.accessNotes || null,
      link: link(context, siteHref(siteId)),
      solutions: solutions.map((solution) => solutionOut(solution, context, settings)),
      proposals: atSite.proposals.map((proposal) => {
        const out = proposalOut(proposal, context);
        return {
          proposal_id: out.proposal_id,
          proposal_code: out.proposal_code,
          title: out.title,
          state: out.state,
          recommended: out.recommended,
          solution_ids: out.solutions.map((s) => s.solution_id),
          total_dollars: out.total_dollars,
          link: out.link,
        };
      }),
    };
  },
});

const jobMathTool = defineTool({
  name: "job_math",
  title: "Job math",
  description:
    "Work out what one job comes to for the owner, with his saved percentages: the buckets taken off the top of the price (profit, marketing, operations), what is left for labor, what he takes home doing it himself after his tax set-aside, the most an hour it could pay a W-2 worker, and what to charge to pay a chosen wage with every bucket intact. Money in and out is in dollars, before sales tax. It changes nothing.",
  inputSchema: z.object({
    price_dollars: z.number().min(0).describe("What the customer pays, before sales tax."),
    hours: z.number().min(0).describe("Hours of work, by whoever does it. May have decimals."),
    other_costs_dollars: z
      .number()
      .min(0)
      .optional()
      .describe("Everything the price pays out that isn't labor: materials, dump fees, rentals. Default 0."),
    wage_dollars: z
      .number()
      .min(0)
      .optional()
      .describe("Hourly W-2 wage to cost the job at. Default: the owner's saved wage."),
  }),
  annotations: Reads,
  async run({ price_dollars, hours, other_costs_dollars = 0, wage_dollars }, context) {
    const settings = await jobMathSettings(context);
    const inputs = {
      priceCents: centsFrom(price_dollars, "The price"),
      laborHours: hours,
      otherCostCents: centsFrom(other_costs_dollars, "Other costs"),
      wageCents: wage_dollars === undefined ? undefined : centsFrom(wage_dollars, "The wage"),
    };
    const math = jobMath(inputs, settings);
    const atWage = math.w2.atWage;
    return {
      price_dollars,
      hours,
      other_costs_dollars,
      buckets: math.buckets.map((bucket) => ({
        name: bucket.label,
        percent: bucket.percent,
        dollars: dollarsOf(bucket.cents),
      })),
      left_for_labor_dollars: dollarsOf(math.laborPoolCents),
      you_do_it: {
        pay_dollars: dollarsOf(math.owner.payCents),
        tax_set_aside_percent: settings.ownerTaxPercent,
        tax_set_aside_dollars: dollarsOf(math.owner.taxSetAsideCents),
        take_home_dollars: dollarsOf(math.owner.takeHomeCents),
        take_home_per_hour_dollars: dollarsOrNull(math.owner.takeHomePerHourCents),
      },
      w2_worker: {
        // Zero or less means the job can't pay anyone.
        max_wage_per_hour_dollars: dollarsOrNull(math.w2.maxWageCents),
        at_wage: {
          wage_per_hour_dollars: dollarsOf(atWage.wageCents),
          wages_dollars: dollarsOf(atWage.wagesCents),
          payroll_taxes_dollars: dollarsOf(atWage.payrollTaxCents),
          workers_comp_dollars: dollarsOf(atWage.workersCompCents),
          total_cost_dollars: dollarsOf(atWage.totalCostCents),
          left_over_dollars: dollarsOf(atWage.leftOverCents),
        },
      },
      charge_to_pay_wage_dollars: dollarsOrNull(math.priceForWageCents),
      link: link(context, jobMathHref(inputs)),
    };
  },
});

const createCustomerTool = defineTool({
  name: "create_customer",
  title: "Add a customer",
  description:
    "Add a customer: their name and at least one of an email or a US phone number. Check with find_customers first so the owner doesn't get the same person twice. Returns the new customer's id and a link; then add their site with create_site.",
  inputSchema: z.object({
    name: z.string().min(1).describe("The customer's full name."),
    email: z.string().optional().describe("Their email address. Proposals are sent to it."),
    phone: z.string().optional().describe("Their US phone number, in any format."),
  }),
  annotations: Adds,
  async run({ name, email = "", phone = "" }, context) {
    const typed = { name, email, phone };
    const existing = await context.convex.query(api.customers.list);
    const { customerId } = await context.convex.action(api.customers.add, typed);
    const warnings = Object.values(contactWarnings(typed, existing));
    return {
      customer_id: customerId,
      name: name.trim(),
      link: link(context, customerHref(customerId)),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  },
});

const createSiteTool = defineTool({
  name: "create_site",
  title: "Add a site",
  description:
    "Add a site (a street address where work happens) to a customer. The app keeps only addresses Google verifies, so the typed address is looked up: when it clearly matches one place the site is made and the address Google returned comes back, which you should read to the owner to confirm. When several places could match, nothing is made: status is choose_address with the candidates; ask the owner which, then call again with that candidate's place_id.",
  inputSchema: z.object({
    customer_id: z.string().min(1).describe("The customer's id, from find_customers or create_customer."),
    address: z
      .string()
      .min(3)
      .describe("The street address as the owner said it, with city and state, such as '4410 NE 94th St, Vancouver WA'."),
    place_id: z
      .string()
      .optional()
      .describe("A candidate's place_id from an earlier choose_address answer, to save that one."),
    unit: z.string().optional().describe("Apartment or unit, such as 'Apt 2'."),
    access_notes: z.string().optional().describe("Gate codes, parking, pets: anything about getting in."),
  }),
  annotations: { ...Adds, idempotentHint: true },
  async run({ customer_id, address, place_id, unit = "", access_notes = "" }, context) {
    const sessionToken = (context.newSessionToken ?? (() => crypto.randomUUID()))();
    let placeId = place_id?.trim();
    if (!placeId) {
      const suggestions = await context.convex.action(api.places.suggest, {
        input: address,
        sessionToken,
      });
      const pick = pickAddress(address, suggestions);
      if (pick.kind === "none")
        throw new ToolRefusal(
          `Google found no street address for "${address}". Ask the owner for the full address with city and state.`,
        );
      if (pick.kind === "choose")
        return {
          status: "choose_address",
          message:
            "Several addresses could match. Ask the owner which one, then call create_site again with its place_id. Nothing was saved.",
          candidates: pick.candidates.map((c) => ({
            place_id: c.placeId,
            address: suggestionText(c),
          })),
        };
      placeId = pick.suggestion.placeId;
    }
    const siteId = await context.convex.action(api.sites.add, {
      customerId: customer_id.trim() as Id<"customers">,
      placeId,
      sessionToken,
      addressLine2: unit,
      accessNotes: access_notes,
    });
    const site = await requireSite(context, siteId);
    return {
      status: "created",
      site_id: siteId,
      site_name: site.site.name,
      address: [site.streetLine, site.cityLine].filter(Boolean).join(", "),
      customer: { customer_id: site.customerId, name: site.customerName },
      link: link(context, siteHref(siteId)),
      message: "Read this address back to the owner to confirm it is the right place.",
    };
  },
});

const createSolutionTool = defineTool({
  name: "create_solution",
  title: "Write a solution",
  description:
    "Write a new Solution at a site: one priced piece of work with a title, a Scope of Work and line items. Unit costs are what the work costs the owner, in dollars; the price is never typed: it is the line items' cost plus the markup (10% unless set), rounded up to the whole dollar, plus any material allowance. Returns the computed price in dollars, a one-line Job math and a link.",
  inputSchema: z.object({
    site_id: z.string().min(1).describe("The site's id."),
    title: z.string().min(1).describe("A short title the customer reads, such as 'Replace gutters'."),
    ...solutionFields,
    material_allowance_dollars: z
      .number()
      .optional()
      .describe("Optional whole-dollar amount for materials that can only be estimated, added to the price with no markup."),
  }),
  annotations: Adds,
  async run(args, context) {
    // Every figure is read first and the solution is written by one mutation,
    // so a refused figure or a dropped call leaves nothing half-written.
    const lineItems = storedLineItems(args.line_items);
    const markupPercent = checkedMarkup(args.markup_percent);
    const materialAllowanceCents = allowanceCents(args.material_allowance_dollars);
    const title = args.title.trim();
    if (!title) throw new ToolRefusal("A Solution needs a title the customer can read.");
    const site = await requireSite(context, args.site_id);

    const solutionId = await context.convex.mutation(api.solutions.create, {
      siteId: site.site._id,
      title,
      ...(args.scope_of_work !== undefined ? { description: args.scope_of_work } : {}),
      ...(lineItems !== undefined ? { lineItems } : {}),
      ...(markupPercent !== undefined ? { markupPercent } : {}),
      ...(materialAllowanceCents !== undefined ? { materialAllowanceCents } : {}),
    });
    const [solution, settings] = await Promise.all([
      requireSolution(context, solutionId),
      jobMathSettings(context),
    ]);
    return solutionOut(solution, context, settings);
  },
});

const updateSolutionTool = defineTool({
  name: "update_solution",
  title: "Change a solution",
  description:
    "Change a Solution: only what is given changes. line_items, when given, replaces every line item the solution had, so send the full list. Set material_allowance_dollars to null to take the allowance off. Unit costs are in dollars. A solution already in a sent or decided proposal can still be changed here, but that proposal keeps what it was sent with. Returns the new price, a one-line Job math and a link.",
  inputSchema: z.object({
    solution_id: z.string().min(1).describe("The solution's id."),
    title: z.string().optional().describe("A new title."),
    ...solutionFields,
    material_allowance_dollars: z
      .number()
      .nullable()
      .optional()
      .describe("Whole dollars for materials, added with no markup; null takes it off."),
  }),
  // It can overwrite the line items and the Scope of Work the owner wrote.
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
  async run(args, context) {
    const lineItems = storedLineItems(args.line_items);
    const markupPercent = checkedMarkup(args.markup_percent);
    const materialAllowanceCents = allowanceCents(args.material_allowance_dollars);
    const before = await requireSolution(context, args.solution_id);
    await context.convex.mutation(api.solutions.update, {
      solutionId: before._id,
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.scope_of_work !== undefined ? { description: args.scope_of_work } : {}),
      ...(lineItems !== undefined ? { lineItems } : {}),
      ...(markupPercent !== undefined ? { markupPercent } : {}),
      ...(materialAllowanceCents !== undefined ? { materialAllowanceCents } : {}),
    });
    const [solution, settings] = await Promise.all([
      requireSolution(context, before._id),
      jobMathSettings(context),
    ]);
    return {
      ...solutionOut(solution, context, settings),
      price_before_dollars: dollarsOrNull(before.price?.priceCents),
    };
  },
});

const draftFields = {
  name: z.string().optional().describe("A name for the proposal. Without one it is called after its solutions."),
  notes: z
    .string()
    .optional()
    .describe("Notes and exclusions: what the job leaves out or depends on, printed in the opening letter."),
};

const createProposalTool = defineTool({
  name: "create_proposal",
  title: "Assemble a draft proposal",
  description:
    "Assemble a draft Proposal at a site from some of its solutions, in the order given. It stays a draft: the owner reviews and sends it from the app, never from here. The deposit is a whole percent of the total, 50 unless given. Washington sites get their sales tax rate looked up. Returns the totals in dollars, what would stop it being sent, and a link.",
  inputSchema: z.object({
    site_id: z.string().min(1).describe("The site's id."),
    solution_ids: z.array(z.string()).describe("The solutions to offer, from get_site, in the order the customer reads them."),
    deposit_percent: z.number().optional().describe("Whole percent of the total due on signing, 0 to 100. Default 50."),
    ...draftFields,
  }),
  annotations: Adds,
  async run(args, context) {
    if (args.deposit_percent !== undefined) {
      const fault = depositPercentFault(args.deposit_percent);
      if (fault) throw new ToolRefusal(proposalFaultMessage(fault));
    }
    const site = await requireSite(context, args.site_id);
    const siteId = site.site._id;
    const solutionIds = await siteSolutionIds(context, siteId, args.solution_ids);

    // One call: the draft and everything in it are inserted together, so a
    // refusal or a dropped call never leaves an empty draft to retry over.
    const proposalId = await context.convex.action(api.proposals.create, {
      siteId,
      solutionIds,
      ...(args.deposit_percent !== undefined ? { depositPercent: args.deposit_percent } : {}),
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
    });
    return proposalOut(await readProposal(context, siteId, proposalId), context);
  },
});

const addSolutionsTool = defineTool({
  name: "add_solutions_to_proposal",
  title: "Add solutions to a draft proposal",
  description:
    "Add solutions from the same site to the end of a draft proposal. Solutions it already offers stay where they are. Only a draft can change; a sent or decided proposal is refused. Returns the new totals in dollars and a link.",
  inputSchema: z.object({
    proposal: z.string().min(1).describe("The proposal_id, or the Proposal ID such as 1215MAIN-P2."),
    solution_ids: z.array(z.string()).min(1).describe("The solutions to add, from get_site."),
  }),
  annotations: { ...Adds, idempotentHint: true },
  async run(args, context) {
    const { row, proposal } = await requireProposal(context, args.proposal);
    if (proposal.state !== "draft")
      throw new ToolRefusal(
        `${proposal.code} is ${proposal.state}, and only a draft proposal can be edited. Make a new draft with create_proposal instead.`,
      );
    const added = await siteSolutionIds(context, row.siteId, args.solution_ids);
    const held = proposal.solutions.map((s) => s.solutionId);
    await context.convex.mutation(api.proposals.update, {
      proposalId: row.proposalId,
      solutionIds: [...held, ...added.filter((id) => !held.includes(id))],
    });
    return proposalOut(await readProposal(context, row.siteId, row.proposalId), context);
  },
});

// In the order ChatGPT lists them: the reads, then the writes.
export const ConnectorTools: ConnectorTool[] = [
  findCustomersTool,
  getSiteTool,
  listProposalsTool,
  getProposalTool,
  jobMathTool,
  createCustomerTool,
  createSiteTool,
  createSolutionTool,
  updateSolutionTool,
  createProposalTool,
  addSolutionsTool,
];

// What the server tells ChatGPT once, when it connects.
export const ConnectorInstructions = `You are the backend of Expand Handyman's staff app, helping the owner estimate handyman work.
All money in and out of these tools is in US dollars. A line item's unit cost is what the work costs the owner; a solution's price is worked out by the app, never typed.
Usual flow: find_customers (or create_customer, then create_site), get_site, create_solution for each piece of work, then create_proposal. Proposals stay drafts here: the owner sends them from the app, and sending, deleting, payments and invoices are not available through these tools.
When a tool returns a link, offer it to the owner so they can check the result in the app.`;
