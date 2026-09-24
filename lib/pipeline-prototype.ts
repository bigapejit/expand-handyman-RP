// PROTOTYPE. Throwaway: the shape of a **Deal** and the seed data the
// Pipeline prototype (app/(shell)/pipeline) plays with. Nothing here is
// persisted or read by production code.
//
// The question being answered: if the Thumbtack page becomes the Pipeline,
// where every job the owner is chasing lives (Thumbtack or not), what does a
// Deal carry and how should the page be laid out?

import { OPEN_STAGES, STAGES, STAGE_LABELS, type Stage } from "@/lib/thumbtack";

export { OPEN_STAGES, STAGES, STAGE_LABELS };
export type { Stage };

/** Where a deal came from. Thumbtack deals carry a chat; the rest do not. */
export type Source = "thumbtack" | "referral" | "repeat" | "website" | "phone";

export const SOURCE_LABELS: Record<Source, string> = {
  thumbtack: "Thumbtack lead",
  referral: "Referral",
  repeat: "Repeat customer",
  website: "Website",
  phone: "Phone / walk-up",
};

export const SOURCES: readonly Source[] = ["thumbtack", "referral", "repeat", "website", "phone"];

/** One line of a deal's history, newest last. */
export type Activity =
  | { kind: "created"; at: number; text: string }
  | { kind: "comment"; at: number; text: string }
  | { kind: "stage"; at: number; from: Stage; to: Stage }
  | { kind: "message"; at: number; from: "customer" | "business"; text: string }
  | { kind: "proposal"; at: number; text: string }
  // The owner ticking off a next step; the text is what the step said.
  | { kind: "done"; at: number; text: string };

export type Deal = {
  id: string;
  customerName: string;
  /** A real customer, when the deal came from Convex (a Thumbtack lead). */
  customerId?: string;
  /** The job in a few words: the Thumbtack category, or what the owner typed. */
  title: string;
  /** Street and city, when known. A deal can start with no site. */
  site?: string;
  source: Source;
  stage: Stage;
  stageChangedAt: number;
  createdAt: number;
  /** Proposal total once one exists, else the owner's ballpark. Whole cents. */
  valueCents?: number;
  /** What the owner means to do next, in their own words. */
  nextStep?: string;
  phone?: string;
  email?: string;
  /** The one free-text notes field of the Quick panel. */
  notes?: string;
  /** Object URLs of photos taken in the Quick panel, in memory only. */
  photos?: string[];
  proposal?: { code: string; state: "draft" | "sent" | "approved" | "declined"; opened?: boolean };
  /** Present on Thumbtack deals: the real lead behind it, if any. */
  lead?: { leadId?: string; negotiationId: string; unread: boolean; description: string };
  activity: Activity[];
};

export const isOpen = (stage: Stage) => OPEN_STAGES.includes(stage);

export function money(cents: number) {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** The last thing the owner wrote on a deal, if anything. */
export function lastComment(deal: Deal) {
  for (let i = deal.activity.length - 1; i >= 0; i--) {
    const a = deal.activity[i];
    if (a.kind === "comment") return a;
  }
  return null;
}

/** The last message either way on a Thumbtack deal, if any. */
export function lastMessage(deal: Deal) {
  for (let i = deal.activity.length - 1; i >= 0; i--) {
    const a = deal.activity[i];
    if (a.kind === "message") return a;
  }
  return null;
}

/**
 * Why a deal wants looking at, in one short phrase, or null when it can wait.
 * The list and workbench variants sort on this; the board shows it on cards.
 */
export function attention(deal: Deal, now: number): string | null {
  if (!isOpen(deal.stage)) return null;
  if (deal.lead?.unread) return "Unread message";
  const days = (now - deal.stageChangedAt) / 86_400_000;
  if (deal.stage === "new" && days >= 1) return "No reply yet";
  if (deal.stage === "quoted" && deal.proposal?.state === "sent") {
    if (days >= 7) return `Sent ${Math.floor(days)} days ago`;
    if (deal.proposal.opened) return "Opened, no answer";
  }
  if (deal.stage === "estimating" && days >= 3) return "Estimate overdue";
  if (deal.stage === "talking" && days >= 4) return "Gone quiet";
  return null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let counter = 0;
export const newId = () => `deal-${++counter}-${Math.random().toString(36).slice(2, 7)}`;

/** Sample deals so every stage has something in it. Built once per page load. */
export function seedDeals(now: number): Deal[] {
  return [
    {
      id: "seed-brandt",
      phone: "(360) 555-0142",
      email: "tom.brandt@example.com",
      customerName: "Tom Brandt",
      title: "Gutter cleaning, two storeys",
      site: "2214 NE 112th Ave, Vancouver",
      source: "phone",
      stage: "new",
      stageChangedAt: now - 30 * HOUR,
      createdAt: now - 30 * HOUR,
      valueCents: 35000,
      nextStep: "Call back with a Saturday slot",
      activity: [
        { kind: "created", at: now - 30 * HOUR, text: "Called the shop line. Wants gutters done before the rain." },
      ],
    },
    {
      id: "seed-delgado",
      phone: "(360) 555-0187",
      email: "maria.delgado@example.com",
      customerName: "Maria Delgado",
      title: "Fence repair, 3 panels + gate latch",
      site: "8907 NE 15th St, Vancouver",
      source: "referral",
      stage: "talking",
      stageChangedAt: now - 2 * DAY,
      createdAt: now - 3 * DAY,
      valueCents: 90000,
      nextStep: "Text photos of the gate hinge",
      activity: [
        { kind: "created", at: now - 3 * DAY, text: "Referred by Ken Oyelaran." },
        { kind: "stage", at: now - 2 * DAY, from: "new", to: "talking" },
        { kind: "comment", at: now - 2 * DAY + HOUR, text: "Called. Wants it done before the 10th, dog keeps getting out. She'll send hinge photos." },
      ],
    },
    {
      id: "seed-henderson",
      phone: "(360) 555-0119",
      email: "jill.henderson@example.com",
      customerName: "Jill Henderson",
      title: "Bathroom fan swap + drywall patch",
      site: "12611 SE 7th St, Vancouver",
      source: "thumbtack",
      stage: "booked",
      stageChangedAt: now - 1 * DAY,
      createdAt: now - 4 * DAY,
      valueCents: 65000,
      nextStep: "Site visit Sat 9:00",
      notes: "Fan is in the hall bath, attic access from the garage. Bring the 110 CFM Panasonic and a sheet of 1/2\" drywall.",
      lead: { negotiationId: "sample-1", unread: false, description: "Bathroom exhaust fan is dead and there's a hole in the ceiling from the last guy." },
      activity: [
        { kind: "created", at: now - 4 * DAY, text: "Arrived from Thumbtack: Handyman." },
        { kind: "message", at: now - 4 * DAY + HOUR, from: "business", text: "Hi Jill, happy to help with the fan and the patch. Could I come by Saturday morning to take a look?" },
        { kind: "message", at: now - 3 * DAY, from: "customer", text: "Saturday works, 9am ok?" },
        { kind: "stage", at: now - 3 * DAY, from: "new", to: "talking" },
        { kind: "message", at: now - 3 * DAY + HOUR / 2, from: "business", text: "9am is perfect. See you then." },
        { kind: "stage", at: now - 1 * DAY, from: "talking", to: "booked" },
        { kind: "comment", at: now - 1 * DAY, text: "Bring the 110 CFM Panasonic and a sheet of 1/2\" drywall just in case." },
      ],
    },
    {
      id: "seed-oyelaran",
      phone: "(360) 555-0163",
      email: "ken.oyelaran@example.com",
      customerName: "Ken Oyelaran",
      title: "Deck board replacement",
      site: "4410 NE 94th St, Vancouver",
      source: "repeat",
      stage: "estimating",
      stageChangedAt: now - 4 * DAY,
      createdAt: now - 9 * DAY,
      valueCents: 240000,
      nextStep: "Price cedar vs. Trex, send both",
      proposal: { code: "441094TH-2", state: "draft" },
      activity: [
        { kind: "created", at: now - 9 * DAY, text: "Did his fence last spring. Texted about the deck." },
        { kind: "stage", at: now - 8 * DAY, from: "new", to: "talking" },
        { kind: "stage", at: now - 6 * DAY, from: "talking", to: "booked" },
        { kind: "stage", at: now - 4 * DAY, from: "booked", to: "estimating" },
        { kind: "comment", at: now - 4 * DAY + 2 * HOUR, text: "Measured: 180 sq ft, 14 boards rotten, joists fine. He asked about composite." },
        { kind: "proposal", at: now - 2 * DAY, text: "Draft proposal 441094TH-2 started" },
      ],
    },
    {
      id: "seed-natarajan",
      phone: "(360) 555-0175",
      email: "priya@example.com",
      customerName: "Priya Natarajan",
      title: "Garage shelving + door weather seal",
      site: "1600 SE Tech Center Dr, Vancouver",
      source: "website",
      stage: "quoted",
      stageChangedAt: now - 3 * DAY,
      createdAt: now - 12 * DAY,
      valueCents: 185000,
      proposal: { code: "1600TECHCENTER-1", state: "sent", opened: true },
      activity: [
        { kind: "created", at: now - 12 * DAY, text: "Website form." },
        { kind: "stage", at: now - 11 * DAY, from: "new", to: "talking" },
        { kind: "stage", at: now - 8 * DAY, from: "talking", to: "booked" },
        { kind: "stage", at: now - 5 * DAY, from: "booked", to: "estimating" },
        { kind: "proposal", at: now - 3 * DAY, text: "Proposal 1600TECHCENTER-1 sent to priya@example.com" },
        { kind: "stage", at: now - 3 * DAY, from: "estimating", to: "quoted" },
        { kind: "proposal", at: now - 2 * DAY, text: "Priya opened the proposal" },
      ],
    },
    {
      id: "seed-nguyen",
      phone: "(360) 555-0128",
      email: "an.nguyen@example.com",
      customerName: "An Nguyen",
      title: "Crown molding, living room",
      site: "7715 NE 51st Cir, Vancouver",
      source: "referral",
      stage: "quoted",
      stageChangedAt: now - 9 * DAY,
      createdAt: now - 20 * DAY,
      valueCents: 142000,
      nextStep: "Nudge, offer to adjust scope",
      proposal: { code: "771551ST-1", state: "sent", opened: false },
      activity: [
        { kind: "created", at: now - 20 * DAY, text: "Neighbour of the Hendersons." },
        { kind: "stage", at: now - 18 * DAY, from: "new", to: "talking" },
        { kind: "stage", at: now - 14 * DAY, from: "talking", to: "booked" },
        { kind: "stage", at: now - 11 * DAY, from: "booked", to: "estimating" },
        { kind: "proposal", at: now - 9 * DAY, text: "Proposal 771551ST-1 sent to an.nguyen@example.com" },
        { kind: "stage", at: now - 9 * DAY, from: "estimating", to: "quoted" },
        { kind: "comment", at: now - 4 * DAY, text: "Texted a nudge, no reply. Might be the price." },
      ],
    },
    {
      id: "seed-fischer",
      phone: "(360) 555-0151",
      email: "lena.fischer@example.com",
      customerName: "Lena Fischer",
      title: "Kitchen faucet + disposal",
      site: "3305 NE 78th St, Vancouver",
      source: "thumbtack",
      stage: "won",
      stageChangedAt: now - 6 * DAY,
      createdAt: now - 15 * DAY,
      valueCents: 78000,
      proposal: { code: "330578TH-1", state: "approved" },
      lead: { negotiationId: "sample-2", unread: false, description: "Faucet drips and the disposal hums but doesn't spin." },
      activity: [
        { kind: "created", at: now - 15 * DAY, text: "Arrived from Thumbtack: Plumbing." },
        { kind: "message", at: now - 15 * DAY + HOUR, from: "business", text: "Hi Lena, I can take a look this week. Which day suits?" },
        { kind: "message", at: now - 14 * DAY, from: "customer", text: "Thursday afternoon?" },
        { kind: "stage", at: now - 14 * DAY, from: "new", to: "talking" },
        { kind: "stage", at: now - 12 * DAY, from: "talking", to: "booked" },
        { kind: "stage", at: now - 9 * DAY, from: "booked", to: "estimating" },
        { kind: "proposal", at: now - 8 * DAY, text: "Proposal 330578TH-1 sent" },
        { kind: "stage", at: now - 8 * DAY, from: "estimating", to: "quoted" },
        { kind: "proposal", at: now - 6 * DAY, text: "Lena approved the proposal. Deposit invoice sent." },
        { kind: "stage", at: now - 6 * DAY, from: "quoted", to: "won" },
      ],
    },
    {
      id: "seed-kowalski",
      phone: "(360) 555-0196",
      email: "dave.k@example.com",
      customerName: "Dave Kowalski",
      title: "Full exterior repaint",
      site: "9020 NE 25th Ave, Vancouver",
      source: "thumbtack",
      stage: "lost",
      stageChangedAt: now - 10 * DAY,
      createdAt: now - 25 * DAY,
      valueCents: 620000,
      lead: { negotiationId: "sample-3", unread: false, description: "Whole house exterior, two colours, 1,900 sq ft." },
      activity: [
        { kind: "created", at: now - 25 * DAY, text: "Arrived from Thumbtack: Exterior Painting." },
        { kind: "message", at: now - 25 * DAY + HOUR, from: "business", text: "Hi Dave, thanks for reaching out. Exterior repaint is a big one, I'd want to see it in person first." },
        { kind: "message", at: now - 24 * DAY, from: "customer", text: "Sure, but I'm collecting a few quotes." },
        { kind: "stage", at: now - 24 * DAY, from: "new", to: "talking" },
        { kind: "comment", at: now - 10 * DAY, text: "Went with a painting outfit. Too big for us anyway." },
        { kind: "stage", at: now - 10 * DAY, from: "talking", to: "lost" },
      ],
    },
  ];
}
