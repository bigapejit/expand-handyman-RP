// PROTOTYPE review page, delete before merge. Fake Thumbtack leads in the
// shapes `leads.board` and `leads.thread` return, so the ungated review page at
// /prototype/thumbtack-board renders the real ThumbtackBoard and LeadPanel
// with no sign-in and no Convex.

import type { FunctionReturnType } from "convex/server";

import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  isUnread,
  type LeadAttachment,
  type LeadEstimate,
  type LeadLocation,
  type Stage,
} from "@/lib/thumbtack";

type BoardLead = FunctionReturnType<typeof api.leads.board>[number];
type LeadMessage = NonNullable<FunctionReturnType<typeof api.leads.thread>>[number];

function svgPhoto(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// A stand-in photo of deck boards, one of them grey and split.
const deckPhoto = svgPhoto(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
    <rect width="320" height="240" fill="#6b4a2f"/>
    ${[0, 1, 2, 3, 4, 5]
      .map(
        (i) =>
          `<rect x="0" y="${i * 40 + 2}" width="320" height="36" fill="${
            i === 3 ? "#7c7f84" : i % 2 ? "#a47148" : "#9a6a42"
          }"/>`,
      )
      .join("")}
    <path d="M40 140 L120 136 L180 142 L260 137" stroke="#3f4145" stroke-width="3" fill="none"/>
    <circle cx="60" cy="42" r="3" fill="#3b2a1a"/><circle cx="260" cy="202" r="3" fill="#3b2a1a"/>
  </svg>`,
);

// A stand-in photo of a bathroom ceiling fan grille.
const fanPhoto = svgPhoto(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
    <rect width="320" height="240" fill="#e7e5e4"/>
    <rect x="100" y="60" width="120" height="120" rx="6" fill="#f5f5f4" stroke="#a8a29e" stroke-width="3"/>
    ${[0, 1, 2, 3, 4, 5, 6]
      .map((i) => `<rect x="112" y="${74 + i * 14}" width="96" height="6" fill="#a8a29e"/>`)
      .join("")}
    <path d="M150 180 Q160 200 175 188" stroke="#78716c" stroke-width="2" fill="none"/>
  </svg>`,
);

const file = (fileName: string, mimeType: string, url: string): LeadAttachment => ({
  fileName,
  fileSize: 0,
  mimeType,
  url,
});

type Said = [
  from: "customer" | "business",
  text: string,
  sentAt: string,
  attachments?: LeadAttachment[],
];

// One lead as written here: what Thumbtack sent, the stage, when the owner
// last opened it, and its chat.
type Source = {
  negotiationId: string;
  stage: Stage;
  openedAt?: string;
  customerName: string;
  phone: string;
  category: string;
  description: string;
  location: LeadLocation;
  details: [question: string, answer: string][];
  attachments?: LeadAttachment[];
  estimate?: LeadEstimate;
  leadPrice?: string;
  arrivedAt: string;
  chat: Said[];
};

const sources: Source[] = [
  // New, two customer messages, no reply yet: unread.
  {
    negotiationId: "512603114927384061",
    stage: "new",
    customerName: "Megan Holloway",
    phone: "+15550102233",
    category: "TV Mounting",
    description:
      "Need a 65 inch TV mounted over the fireplace. Wall is brick. I have the mount already.",
    location: { address1: "1408 NE 139th St", city: "Vancouver", state: "WA", zipCode: "98685" },
    details: [
      ["TV size", '60" - 69"'],
      ["Wall type", "Brick or stone"],
      ["Do you have a mount?", "Yes, I have a mount"],
      ["Hide the wires?", "Yes, if possible"],
      ["When do you need this done?", "Within a week"],
    ],
    estimate: { type: "Fixed", total: "$225.00" },
    leadPrice: "$34.00",
    arrivedAt: "2026-09-23T15:12:00.000Z",
    chat: [
      [
        "customer",
        "Hi! Can you do brick? The fireplace is about 5 ft wide.",
        "2026-09-23T15:12:00.000Z",
      ],
      [
        "customer",
        "Also Saturday morning works best for us if you have it.",
        "2026-09-23T16:41:00.000Z",
      ],
    ],
  },
  // New, only city and zip, read.
  {
    negotiationId: "512598870341152790",
    stage: "new",
    openedAt: "2026-09-22T23:10:00.000Z",
    customerName: "Derek Nguyen",
    phone: "+15550104187",
    category: "Drywall Repair",
    description: "Doorknob went through the drywall in the hallway. Hole is about fist sized.",
    location: { city: "Portland", state: "OR", zipCode: "97217" },
    details: [
      ["What needs repair?", "Hole or dent"],
      ["Size of damage", "Smaller than 1 sq ft"],
      ["Paint match needed?", "Yes"],
    ],
    estimate: { type: "Fixed", total: "$150.00" },
    leadPrice: "$21.50",
    arrivedAt: "2026-09-22T22:05:00.000Z",
    chat: [
      [
        "customer",
        "Is this something you can do in one visit, paint included?",
        "2026-09-22T22:05:00.000Z",
      ],
    ],
  },
  // New, the request carries a file.
  {
    negotiationId: "512571209934817203",
    stage: "new",
    customerName: "Priya Raman",
    phone: "+15550107765",
    category: "Furniture Assembly",
    description:
      "Two IKEA PAX wardrobes and a MALM dresser. Everything is still in the boxes in the bedroom.",
    location: { address1: "2217 NW Lacamas Dr", city: "Camas", state: "WA", zipCode: "98607" },
    details: [
      ["What needs assembly?", "Wardrobe, Dresser"],
      ["How many items?", "3"],
      ["Brand", "IKEA"],
      ["Anchor to the wall?", "Yes"],
    ],
    attachments: [file("IKEA-order-2291.pdf", "application/pdf", "#")],
    estimate: { type: "MoreInfo" },
    leadPrice: "$18.75",
    arrivedAt: "2026-09-21T17:48:00.000Z",
    chat: [
      ["customer", "Order list attached. Weekday afternoons are fine.", "2026-09-21T17:48:00.000Z"],
    ],
  },
  // Talking, the customer sent a photo, and wrote again since the last open.
  {
    negotiationId: "512540087216639514",
    stage: "talking",
    openedAt: "2026-09-22T19:05:00.000Z",
    customerName: "Tom Becker",
    phone: "+15550109014",
    category: "Deck Repair",
    description:
      "Three or four deck boards are soft and one is cracked. Would like them replaced before winter.",
    location: {
      address1: "915 SW 12th Ave",
      city: "Battle Ground",
      state: "WA",
      zipCode: "98604",
    },
    details: [
      ["Deck material", "Wood"],
      ["What needs repair?", "Boards"],
      ["Deck size", "200 - 400 sq ft"],
    ],
    estimate: { type: "Hourly", pricePerUnit: "$85.00", unitName: "hour" },
    leadPrice: "$29.00",
    arrivedAt: "2026-09-19T20:30:00.000Z",
    chat: [
      [
        "customer",
        "Hi, can you take a look at our deck? A few boards are going soft.",
        "2026-09-19T20:30:00.000Z",
      ],
      [
        "business",
        "Hi Tom, happy to. Could you send a photo of the worst boards? Pressure treated or cedar?",
        "2026-09-19T21:14:00.000Z",
      ],
      [
        "customer",
        "Cedar I think. Here's the worst one, by the back door.",
        "2026-09-20T16:02:00.000Z",
        [file("IMG_4471.jpg", "image/jpeg", deckPhoto)],
      ],
      [
        "business",
        "That joist under it may be wet too. I can come by Thursday to check. Would 10am work?",
        "2026-09-22T18:55:00.000Z",
      ],
      ["customer", "Thursday at 10 is good. Gate code is 4410.", "2026-09-23T02:37:00.000Z"],
    ],
  },
  // Talking, both sides, read, the owner wrote last.
  {
    negotiationId: "512519342877105628",
    stage: "talking",
    openedAt: "2026-09-21T16:20:00.000Z",
    customerName: "Linda Ortiz",
    phone: "+15550103358",
    category: "Door Repair",
    description:
      "Front door won't latch unless you slam it. Started after the weather turned. Deadbolt also sticks.",
    location: {
      address1: "3620 SE Belmont St",
      city: "Portland",
      state: "OR",
      zipCode: "97214",
    },
    details: [
      ["Type of door", "Exterior"],
      ["What's the problem?", "Won't latch or close"],
      ["Door material", "Wood"],
    ],
    estimate: { type: "Fixed", total: "$150.00" },
    leadPrice: "$24.00",
    arrivedAt: "2026-09-18T15:40:00.000Z",
    chat: [
      [
        "customer",
        "Hello, is this something you fix? It's an old house.",
        "2026-09-18T15:40:00.000Z",
      ],
      [
        "business",
        "Yes, usually the strike plate needs moving or the hinges need shimming. $150 covers both.",
        "2026-09-18T17:02:00.000Z",
      ],
      [
        "customer",
        "Great. My husband wants to know if you can also look at the back door while you're here.",
        "2026-09-21T15:58:00.000Z",
      ],
      [
        "business",
        "Sure, I'll check both. I'll send a quote for the two doors tonight.",
        "2026-09-21T16:19:00.000Z",
      ],
    ],
  },
  // Quoted, with a photo on the request.
  {
    negotiationId: "512488815602293347",
    stage: "quoted",
    openedAt: "2026-09-20T01:10:00.000Z",
    customerName: "Kevin Marsh",
    phone: "+15550106621",
    category: "Bathroom Fan Installation",
    description:
      "Bathroom fan is loud and barely pulls air. Want it swapped for a quiet one, same hole if possible.",
    location: {
      address1: "4812 Columbia House Blvd",
      city: "Vancouver",
      state: "WA",
      zipCode: "98661",
    },
    details: [
      ["Install or replace?", "Replace existing fan"],
      ["Attic access above?", "Yes"],
      ["Fan purchased?", "No, I need the pro to supply it"],
    ],
    attachments: [file("fan.jpg", "image/jpeg", fanPhoto)],
    estimate: { type: "OnSite" },
    leadPrice: "$27.00",
    arrivedAt: "2026-09-16T18:22:00.000Z",
    chat: [
      ["customer", "Photo of the current fan attached.", "2026-09-16T18:22:00.000Z"],
      [
        "business",
        "Thanks Kevin. I stopped by today; quote for a Panasonic WhisperCeiling swap is on its way by email.",
        "2026-09-19T23:45:00.000Z",
      ],
      ["customer", "Got it, will look this weekend.", "2026-09-20T00:31:00.000Z"],
    ],
  },
  // Won.
  {
    negotiationId: "512433970158820419",
    stage: "won",
    openedAt: "2026-09-15T20:00:00.000Z",
    customerName: "Ruth Adler",
    phone: "+15550108842",
    category: "Gutter Cleaning",
    description: "Gutters full of fir needles again. Single story, about 140 feet total.",
    location: { address1: "118 N 5th Ave", city: "Ridgefield", state: "WA", zipCode: "98642" },
    details: [
      ["Home height", "1 story"],
      ["Gutter length", "100 - 150 ft"],
      ["Downspouts clogged?", "Not sure"],
    ],
    estimate: { type: "Fixed", total: "$220.00" },
    leadPrice: "$16.00",
    arrivedAt: "2026-09-12T16:05:00.000Z",
    chat: [
      ["customer", "Are you available next week?", "2026-09-12T16:05:00.000Z"],
      [
        "business",
        "I am. Tuesday morning, $220 including flushing the downspouts.",
        "2026-09-12T17:30:00.000Z",
      ],
      ["customer", "Perfect, see you Tuesday.", "2026-09-12T18:02:00.000Z"],
    ],
  },
  // Lost.
  {
    negotiationId: "512410558391076682",
    stage: "lost",
    openedAt: "2026-09-14T22:40:00.000Z",
    customerName: "Sam Whitaker",
    phone: "+15550105590",
    category: "Shelf Installation",
    description:
      "Floating shelves in the living room, 4 of them, into drywall. Want them to hold books.",
    location: {
      address1: "15530 SW Division St",
      city: "Beaverton",
      state: "OR",
      zipCode: "97005",
    },
    details: [
      ["How many shelves?", "4"],
      ["Wall type", "Drywall"],
      ["Shelves purchased?", "Yes"],
    ],
    estimate: { type: "Hourly", total: "$85.00" },
    leadPrice: "$19.25",
    arrivedAt: "2026-09-10T19:15:00.000Z",
    chat: [
      ["customer", "How long would 4 shelves take?", "2026-09-10T19:15:00.000Z"],
      [
        "business",
        "About 2 hours if the studs line up. $85 an hour.",
        "2026-09-10T20:01:00.000Z",
      ],
      ["customer", "Thanks, we went with someone closer.", "2026-09-14T22:38:00.000Z"],
    ],
  },
];

const leadIdOf = (source: Source) => `lead_${source.negotiationId}` as Id<"leads">;

function messagesOf(source: Source): LeadMessage[] {
  return source.chat.map(([from, text, sentAt, attachments = []], index) => ({
    _id: `msg_${source.negotiationId}_${index}` as Id<"leadMessages">,
    _creationTime: Date.parse(sentAt),
    leadId: leadIdOf(source),
    messageId: `m-${source.negotiationId}-${index}`,
    from,
    text,
    attachments,
    sentAt: Date.parse(sentAt),
  }));
}

function boardLeadOf(source: Source): BoardLead {
  const messages = messagesOf(source);
  const last = messages.at(-1);
  const fromCustomer = messages.filter((m) => m.from === "customer").at(-1);
  const arrivedAt = Date.parse(source.arrivedAt);
  const fields = {
    _id: leadIdOf(source),
    _creationTime: arrivedAt,
    customerId: `customer_${source.negotiationId}` as Id<"customers">,
    negotiationId: source.negotiationId,
    thumbtackCustomerId: `tc_${source.negotiationId}`,
    arrivedAt,
    category: source.category,
    description: source.description,
    details: source.details.map(([question, answer]) => ({ question, answer })),
    location: source.location,
    attachments: source.attachments ?? [],
    estimate: source.estimate,
    leadPrice: source.leadPrice,
    stage: source.stage,
    stageChangedAt: arrivedAt,
    lastMessageAt: last?.sentAt,
    lastCustomerMessageAt: fromCustomer?.sentAt,
    openedAt: source.openedAt ? Date.parse(source.openedAt) : undefined,
  };
  return {
    ...fields,
    customerName: source.customerName,
    phone: source.phone,
    phoneFrom: "thumbtack",
    lastMessage: last ? { text: last.text, from: last.from, sentAt: last.sentAt } : null,
    unread: isUnread(fields),
  };
}

/** What `leads.board` would return: every lead, newest first. */
export const prototypeBoard: BoardLead[] = sources
  .map(boardLeadOf)
  .sort((a, b) => b.arrivedAt - a.arrivedAt);

/** What `leads.thread` would return, by lead. */
export const prototypeThreads: Record<string, LeadMessage[]> = Object.fromEntries(
  sources.map((source) => [leadIdOf(source), messagesOf(source)]),
);
