// Thumbtack's webhooks read into the app's own words (CONTEXT.md, **Lead**,
// **Stage**, **Unread**). Shapes follow Thumbtack's v4 spec
// (docs/research/thumbtack-webhooks.md, sections 3 and 4); where the docs'
// own samples drift from the spec, both spellings are read, because nobody has
// seen a real payload yet and a lead that fails to land is the worst outcome.

export type Stage = "new" | "talking" | "booked" | "estimating" | "quoted" | "won" | "lost";

export const STAGES: readonly Stage[] = [
  "new",
  "talking",
  "booked",
  "estimating",
  "quoted",
  "won",
  "lost",
];

export const STAGE_LABELS: Record<Stage, string> = {
  new: "New",
  talking: "Talking",
  booked: "Booked",
  estimating: "Estimating",
  // Stored as `quoted`; the owner reads it as "Sent out".
  quoted: "Sent out",
  won: "Won",
  lost: "Lost",
};

// Won and Lost are final and leave the Thumbtack board.
export const OPEN_STAGES: readonly Stage[] = ["new", "talking", "booked", "estimating", "quoted"];

export type LeadAttachment = {
  fileName: string;
  fileSize: number;
  mimeType: string;
  url: string;
  description?: string;
};

export type LeadEstimate = {
  type: string;
  total?: string;
  pricePerUnit?: string;
  unitQuantity?: number;
  unitName?: string;
};

export type LeadLocation = {
  address1?: string;
  address2?: string;
  city: string;
  state: string;
  zipCode: string;
};

/** A lead as the `leads` table keeps it, minus what the app decides. */
export type LeadFields = {
  negotiationId: string;
  thumbtackCustomerId: string;
  arrivedAt: number;
  category: string;
  description: string;
  details: { question: string; answer: string }[];
  location: LeadLocation;
  attachments: LeadAttachment[];
  estimate?: LeadEstimate;
  leadPrice?: string;
};

export type ParsedLead = LeadFields & {
  customerName: string;
  // As Thumbtack sent it; the caller normalizes it, or keeps it raw when it
  // is not a number the app's validator would take.
  phone: string;
};

export type ParsedMessage = {
  messageId: string;
  negotiationId: string;
  from: "customer" | "business";
  text: string;
  attachments: LeadAttachment[];
  sentAt: number;
  customerDisplayName?: string;
  thumbtackCustomerId?: string;
};

export type Fault = { fault: string };

// A customer with no name on the payload still needs one to be listed under.
export const UNNAMED_CUSTOMER = "Thumbtack customer";

// The category of a lead made up for a message whose lead the app never saw
// (a lead from before the webhook was switched on, or one still on its way).
// The lead's own webhook fills it in if it ever arrives.
export const PLACEHOLDER_CATEGORY = "Thumbtack message";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const objectAt = (value: unknown): Json => (isObject(value) ? value : {});

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

// IDs are int64s sent as strings; a number is accepted in case one arrives bare.
const id = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
};

const number = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return undefined;
};

const time = (value: unknown): number | undefined => {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
};

// Convex refuses an explicit `undefined` in some places and not others; an
// absent key is always fine.
function defined<T extends Json>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}

/** The body's `event.eventType`, or "" when it has none. */
export function eventTypeOf(body: unknown): string {
  return text(objectAt(objectAt(body).event).eventType) ?? "";
}

export function eventKind(body: unknown): "lead" | "message" | "other" {
  const type = eventTypeOf(body);
  if (type === "NegotiationCreatedV4") return "lead";
  // The spec's enum says MessageCreatedV4; its schema is named MessageSentV4.
  if (type === "MessageCreatedV4" || type === "MessageSentV4") return "message";
  return "other";
}

// The event's `data`. The docs' GET samples have no envelope at all, so a
// body without `data` is read as the data itself.
const dataOf = (body: unknown): Json => {
  const whole = objectAt(body);
  return isObject(whole.data) ? whole.data : whole;
};

export function parseAttachments(value: unknown): LeadAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((a) =>
    defined({
      fileName: text(a.fileName) ?? "",
      fileSize: number(a.fileSize) ?? 0,
      mimeType: text(a.mimeType) ?? "",
      url: text(a.url) ?? "",
      description: text(a.description) || undefined,
    }),
  );
}

function parseEstimate(value: unknown): LeadEstimate | undefined {
  if (!isObject(value)) return undefined;
  const type = text(value.type);
  if (!type) return undefined;
  return defined({
    type,
    total: text(value.total),
    pricePerUnit: text(value.pricePerUnit),
    unitQuantity: number(value.unitQuantity),
    unitName: text(value.unitName),
  });
}

function customerNameOf(customer: Json): string {
  const full = [text(customer.firstName), text(customer.lastName)]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    full ||
    text(customer.displayName)?.trim() ||
    text(customer.name)?.trim() ||
    UNNAMED_CUSTOMER
  );
}

/**
 * A `NegotiationCreatedV4` body read into a lead. Only what the app cannot
 * file a lead without is a fault: Thumbtack's lead ID, its customer ID and when
 * the lead was made. Everything else defaults, so a thin payload still lands.
 */
export function parseLeadEvent(body: unknown): ParsedLead | Fault {
  const data = dataOf(body);
  const customer = objectAt(data.customer);
  const request = objectAt(data.request);

  const negotiationId = id(data.negotiationID);
  if (!negotiationId) return { fault: "The lead has no negotiationID." };
  const thumbtackCustomerId = id(customer.customerID) ?? id(request.customerID);
  if (!thumbtackCustomerId) return { fault: "The lead has no customer.customerID." };
  const arrivedAt =
    time(data.createdAt) ??
    time(data.createTime) ??
    time(objectAt(objectAt(body).event).triggeredAt);
  if (arrivedAt === undefined) return { fault: "The lead has no createdAt." };

  const category = objectAt(request.category ?? data.category);
  const location = objectAt(request.location ?? customer.location);
  const details = Array.isArray(request.details ?? data.details)
    ? ((request.details ?? data.details) as unknown[])
    : [];

  return defined({
    negotiationId,
    thumbtackCustomerId,
    arrivedAt,
    customerName: customerNameOf(customer),
    phone: text(customer.phone)?.trim() ?? "",
    category: text(category.name) ?? "",
    description: text(request.description) ?? "",
    details: details.filter(isObject).map((d) => ({
      question: text(d.question) ?? "",
      answer: text(d.answer) ?? "",
    })),
    location: defined({
      address1: text(location.address1) || undefined,
      address2: text(location.address2) || undefined,
      city: text(location.city) ?? "",
      state: text(location.state) ?? "",
      zipCode: text(location.zipCode) ?? "",
    }),
    attachments: parseAttachments(request.attachments),
    estimate: parseEstimate(data.estimate),
    leadPrice: text(data.leadPrice) || undefined,
  });
}

/** A `MessageCreatedV4` body read into one message of a Thumbtack chat. */
export function parseMessageEvent(body: unknown): ParsedMessage | Fault {
  const data = dataOf(body);
  const messageId = id(data.messageID);
  if (!messageId) return { fault: "The message has no messageID." };
  const negotiationId = id(data.negotiationID);
  if (!negotiationId) return { fault: "The message has no negotiationID." };
  const sender = text(data.from)?.toLowerCase();
  if (sender !== "customer" && sender !== "business")
    return { fault: `The message's from is ${JSON.stringify(data.from ?? null)}.` };
  const sentAt = time(data.sentAt);
  if (sentAt === undefined) return { fault: "The message has no sentAt." };
  const customer = objectAt(data.customer);
  return defined({
    messageId,
    negotiationId,
    from: sender,
    text: text(data.text) ?? "",
    attachments: parseAttachments(data.attachments),
    sentAt,
    customerDisplayName: text(customer.displayName)?.trim() || undefined,
    thumbtackCustomerId: id(customer.customerID),
  });
}

/** **Unread**: the customer has written since the owner last opened the lead. */
export function isUnread(lead: { lastCustomerMessageAt?: number; openedAt?: number }) {
  return (lead.lastCustomerMessageAt ?? 0) > (lead.openedAt ?? 0);
}

/** The owner wrote last: the ball is in the customer's court. */
export function waitingOnThem(lead: { lastMessage: { from: "customer" | "business" } | null }) {
  return lead.lastMessage?.from === "business";
}

// The moves the app makes for the owner (CONTEXT.md, **Stage**). Each only
// ever moves a lead forward, never out of a later stage or a final one.

/** A customer's message moves New to Talking, once the owner has written too. */
export function stageOnCustomerReply(stage: Stage, hadBusinessMessage: boolean): Stage {
  return stage === "new" && hadBusinessMessage ? "talking" : stage;
}

export function stageOnProposalSent(stage: Stage): Stage {
  return OPEN_STAGES.includes(stage) && stage !== "quoted" ? "quoted" : stage;
}

export function stageOnProposalApproved(stage: Stage): Stage {
  return OPEN_STAGES.includes(stage) ? "won" : stage;
}

// Not in any payload; the pattern the pro inbox uses, unverified by Thumbtack.
export function conversationUrl(negotiationId: string) {
  return `https://www.thumbtack.com/pro-inbox/messages/${negotiationId}`;
}

/** "5m ago", "3h ago", "2d ago": how long before `now` something happened. */
export function timeAgo(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  return minutes < 1 ? "just now" : `${duration(now - at)} ago`;
}

/** "under a minute", "5m", "3h", "2d": how long a span of `ms` lasts. */
export function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** "Vancouver, WA", or whichever half of it Thumbtack sent. */
export function placeOf(location: LeadLocation): string {
  return [location.city, location.state].filter(Boolean).join(", ");
}

/** The street, then the place and zip, as one line. */
export function addressLine(location: LeadLocation): string {
  const place = [placeOf(location), location.zipCode].filter(Boolean).join(" ");
  return [location.address1, location.address2, place].filter(Boolean).join(", ");
}

// Thumbtack words prices "$225.00"; the cents say nothing on a round figure.
const dollars = (price: string) => price.replace(/\.00$/, "");

/** Thumbtack's own estimate in a line, or null when the lead carries none. */
export function estimateLine(estimate: LeadEstimate | undefined): string | null {
  if (!estimate) return null;
  const { type, total, pricePerUnit, unitName } = estimate;
  if (type === "Fixed" && total) return `Estimate: ${dollars(total)} fixed`;
  if (type === "Hourly" && (pricePerUnit || total))
    return `Estimate: ${dollars(pricePerUnit || total || "")}/hr`;
  if (type === "PerUnit" && pricePerUnit)
    return `Estimate: ${dollars(pricePerUnit)} per ${unitName || "unit"}${total ? `, ${dollars(total)} total` : ""}`;
  if (type === "OnSite") return "Estimate: after a site visit";
  return "Estimate: needs more info";
}

// Compares every character whatever the first difference, so the time taken
// says little about how much of a guess was right.
function sameSecret(a: string, b: string) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}

function basicPassword(authorization: string | null): string | undefined {
  const match = authorization?.match(/^Basic\s+(\S+)\s*$/i);
  if (!match) return undefined;
  try {
    const decoded = atob(match[1]);
    const colon = decoded.indexOf(":");
    return colon === -1 ? undefined : decoded.slice(colon + 1);
  } catch {
    return undefined;
  }
}

/**
 * Thumbtack signs nothing; a webhook carries either HTTP Basic credentials or
 * a custom header, as set up on its side. Either one holding the shared
 * secret is enough, whatever the username. No secret, no entry.
 */
export function webhookAuthorized(headers: Headers, secret: string | undefined) {
  if (!secret) return false;
  const password = basicPassword(headers.get("Authorization"));
  if (password !== undefined && sameSecret(password, secret)) return true;
  const header = headers.get("X-Thumbtack-Secret");
  return header !== null && sameSecret(header, secret);
}
