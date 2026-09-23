// PROTOTYPE, delete before merge. Fake Thumbtack leads for the board
// prototype, shaped like the v4 webhook payloads (NegotiationCreatedV4 and
// MessageCreatedV4's data) so the look is judged against the real fields.

export type ThumbtackAttachment = {
  fileName: string;
  mimeType: string;
  url: string;
};

export type NegotiationCreatedV4 = {
  negotiationID: string;
  customer: {
    customerID: string;
    firstName: string;
    lastName: string;
    phone: string;
  };
  request: {
    description: string;
    category: { name: string };
    location: {
      address1?: string;
      city: string;
      state: string;
      zipCode: string;
    };
    details: { question: string; answer: string }[];
    attachments: ThumbtackAttachment[];
  };
  estimate: {
    type: "Fixed" | "Hourly" | "OnSite" | "MoreInfo";
    total?: string;
  };
  leadPrice: string;
  createdAt: string;
};

export type MessageCreatedV4 = {
  messageID: string;
  negotiationID: string;
  from: "Customer" | "Business";
  text: string;
  attachments: ThumbtackAttachment[];
  sentAt: string;
};

export type LeadStage = "new" | "talking" | "quoted" | "won" | "lost";

// What the app would keep beside the payloads: the owner's stage, and when he
// last opened the lead (the unread dot is any customer message after that).
export type PrototypeLead = {
  negotiation: NegotiationCreatedV4;
  messages: MessageCreatedV4[];
  stage: LeadStage;
  lastOpenedAt: string | null;
};

// A fixed "now" so relative times match between the server and the browser.
export const PROTOTYPE_NOW = "2026-09-23T18:30:00.000Z";

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

export const prototypeLeads: PrototypeLead[] = [
  // New, two customer messages, no reply yet: unread.
  {
    stage: "new",
    lastOpenedAt: null,
    negotiation: {
      negotiationID: "512603114927384061",
      customer: {
        customerID: "418829301177265024",
        firstName: "Megan",
        lastName: "Holloway",
        phone: "+15550102233",
      },
      request: {
        description:
          "Need a 65 inch TV mounted over the fireplace. Wall is brick. I have the mount already.",
        category: { name: "TV Mounting" },
        location: {
          address1: "1408 NE 139th St",
          city: "Vancouver",
          state: "WA",
          zipCode: "98685",
        },
        details: [
          { question: "TV size", answer: "60\" - 69\"" },
          { question: "Wall type", answer: "Brick or stone" },
          { question: "Do you have a mount?", answer: "Yes, I have a mount" },
          { question: "Hide the wires?", answer: "Yes, if possible" },
          { question: "When do you need this done?", answer: "Within a week" },
        ],
        attachments: [],
      },
      estimate: { type: "Fixed", total: "$225.00" },
      leadPrice: "$34.00",
      createdAt: "2026-09-23T15:12:00.000Z",
    },
    messages: [
      {
        messageID: "m-5126-01",
        negotiationID: "512603114927384061",
        from: "Customer",
        text: "Hi! Can you do brick? The fireplace is about 5 ft wide.",
        attachments: [],
        sentAt: "2026-09-23T15:12:00.000Z",
      },
      {
        messageID: "m-5126-02",
        negotiationID: "512603114927384061",
        from: "Customer",
        text: "Also Saturday morning works best for us if you have it.",
        attachments: [],
        sentAt: "2026-09-23T16:41:00.000Z",
      },
    ],
  },
  // New, only city and zip.
  {
    stage: "new",
    lastOpenedAt: "2026-09-22T23:10:00.000Z",
    negotiation: {
      negotiationID: "512598870341152790",
      customer: {
        customerID: "418830044512896117",
        firstName: "Derek",
        lastName: "Nguyen",
        phone: "+15550104187",
      },
      request: {
        description: "Doorknob went through the drywall in the hallway. Hole is about fist sized.",
        category: { name: "Drywall Repair" },
        location: { city: "Portland", state: "OR", zipCode: "97217" },
        details: [
          { question: "What needs repair?", answer: "Hole or dent" },
          { question: "Size of damage", answer: "Smaller than 1 sq ft" },
          { question: "Paint match needed?", answer: "Yes" },
        ],
        attachments: [],
      },
      estimate: { type: "Fixed", total: "$150.00" },
      leadPrice: "$21.50",
      createdAt: "2026-09-22T22:05:00.000Z",
    },
    messages: [
      {
        messageID: "m-5125-01",
        negotiationID: "512598870341152790",
        from: "Customer",
        text: "Is this something you can do in one visit, paint included?",
        attachments: [],
        sentAt: "2026-09-22T22:05:00.000Z",
      },
    ],
  },
  // New, request carries a file.
  {
    stage: "new",
    lastOpenedAt: null,
    negotiation: {
      negotiationID: "512571209934817203",
      customer: {
        customerID: "418826715390047712",
        firstName: "Priya",
        lastName: "Raman",
        phone: "+15550107765",
      },
      request: {
        description:
          "Two IKEA PAX wardrobes and a MALM dresser. Everything is still in the boxes in the bedroom.",
        category: { name: "Furniture Assembly" },
        location: {
          address1: "2217 NW Lacamas Dr",
          city: "Camas",
          state: "WA",
          zipCode: "98607",
        },
        details: [
          { question: "What needs assembly?", answer: "Wardrobe, Dresser" },
          { question: "How many items?", answer: "3" },
          { question: "Brand", answer: "IKEA" },
          { question: "Anchor to the wall?", answer: "Yes" },
        ],
        attachments: [
          {
            fileName: "IKEA-order-2291.pdf",
            mimeType: "application/pdf",
            url: "#",
          },
        ],
      },
      estimate: { type: "MoreInfo" },
      leadPrice: "$18.75",
      createdAt: "2026-09-21T17:48:00.000Z",
    },
    messages: [
      {
        messageID: "m-5125-11",
        negotiationID: "512571209934817203",
        from: "Customer",
        text: "Order list attached. Weekday afternoons are fine.",
        attachments: [],
        sentAt: "2026-09-21T17:48:00.000Z",
      },
    ],
  },
  // Talking, the customer sent a photo.
  {
    stage: "talking",
    lastOpenedAt: "2026-09-22T19:05:00.000Z",
    negotiation: {
      negotiationID: "512540087216639514",
      customer: {
        customerID: "418821190376604883",
        firstName: "Tom",
        lastName: "Becker",
        phone: "+15550109014",
      },
      request: {
        description:
          "Three or four deck boards are soft and one is cracked. Would like them replaced before winter.",
        category: { name: "Deck Repair" },
        location: {
          address1: "915 SW 12th Ave",
          city: "Battle Ground",
          state: "WA",
          zipCode: "98604",
        },
        details: [
          { question: "Deck material", answer: "Wood" },
          { question: "What needs repair?", answer: "Boards" },
          { question: "Deck size", answer: "200 - 400 sq ft" },
        ],
        attachments: [],
      },
      estimate: { type: "Hourly", total: "$85.00" },
      leadPrice: "$29.00",
      createdAt: "2026-09-19T20:30:00.000Z",
    },
    messages: [
      {
        messageID: "m-5124-01",
        negotiationID: "512540087216639514",
        from: "Customer",
        text: "Hi, can you take a look at our deck? A few boards are going soft.",
        attachments: [],
        sentAt: "2026-09-19T20:30:00.000Z",
      },
      {
        messageID: "m-5124-02",
        negotiationID: "512540087216639514",
        from: "Business",
        text: "Hi Tom, happy to. Could you send a photo of the worst boards? Pressure treated or cedar?",
        attachments: [],
        sentAt: "2026-09-19T21:14:00.000Z",
      },
      {
        messageID: "m-5124-03",
        negotiationID: "512540087216639514",
        from: "Customer",
        text: "Cedar I think. Here's the worst one, by the back door.",
        attachments: [
          { fileName: "IMG_4471.jpg", mimeType: "image/jpeg", url: deckPhoto },
        ],
        sentAt: "2026-09-20T16:02:00.000Z",
      },
      {
        messageID: "m-5124-04",
        negotiationID: "512540087216639514",
        from: "Business",
        text: "That joist under it may be wet too. I can come by Thursday to check. Would 10am work?",
        attachments: [],
        sentAt: "2026-09-22T18:55:00.000Z",
      },
      {
        messageID: "m-5124-05",
        negotiationID: "512540087216639514",
        from: "Customer",
        text: "Thursday at 10 is good. Gate code is 4410.",
        attachments: [],
        sentAt: "2026-09-23T02:37:00.000Z",
      },
    ],
  },
  // Talking, both sides, read.
  {
    stage: "talking",
    lastOpenedAt: "2026-09-21T16:20:00.000Z",
    negotiation: {
      negotiationID: "512519342877105628",
      customer: {
        customerID: "418819903120548776",
        firstName: "Linda",
        lastName: "Ortiz",
        phone: "+15550103358",
      },
      request: {
        description:
          "Front door won't latch unless you slam it. Started after the weather turned. Deadbolt also sticks.",
        category: { name: "Door Repair" },
        location: {
          address1: "3620 SE Belmont St",
          city: "Portland",
          state: "OR",
          zipCode: "97214",
        },
        details: [
          { question: "Type of door", answer: "Exterior" },
          { question: "What's the problem?", answer: "Won't latch or close" },
          { question: "Door material", answer: "Wood" },
        ],
        attachments: [],
      },
      estimate: { type: "Fixed", total: "$150.00" },
      leadPrice: "$24.00",
      createdAt: "2026-09-18T15:40:00.000Z",
    },
    messages: [
      {
        messageID: "m-5123-01",
        negotiationID: "512519342877105628",
        from: "Customer",
        text: "Hello, is this something you fix? It's an old house.",
        attachments: [],
        sentAt: "2026-09-18T15:40:00.000Z",
      },
      {
        messageID: "m-5123-02",
        negotiationID: "512519342877105628",
        from: "Business",
        text: "Yes, usually the strike plate needs moving or the hinges need shimming. $150 covers both.",
        attachments: [],
        sentAt: "2026-09-18T17:02:00.000Z",
      },
      {
        messageID: "m-5123-03",
        negotiationID: "512519342877105628",
        from: "Customer",
        text: "Great. My husband wants to know if you can also look at the back door while you're here.",
        attachments: [],
        sentAt: "2026-09-21T15:58:00.000Z",
      },
      {
        messageID: "m-5123-04",
        negotiationID: "512519342877105628",
        from: "Business",
        text: "Sure, I'll check both. I'll send a quote for the two doors tonight.",
        attachments: [],
        sentAt: "2026-09-21T16:19:00.000Z",
      },
    ],
  },
  // Quoted.
  {
    stage: "quoted",
    lastOpenedAt: "2026-09-20T01:10:00.000Z",
    negotiation: {
      negotiationID: "512488815602293347",
      customer: {
        customerID: "418815571209983310",
        firstName: "Kevin",
        lastName: "Marsh",
        phone: "+15550106621",
      },
      request: {
        description:
          "Bathroom fan is loud and barely pulls air. Want it swapped for a quiet one, same hole if possible.",
        category: { name: "Bathroom Fan Installation" },
        location: {
          address1: "4812 Columbia House Blvd",
          city: "Vancouver",
          state: "WA",
          zipCode: "98661",
        },
        details: [
          { question: "Install or replace?", answer: "Replace existing fan" },
          { question: "Attic access above?", answer: "Yes" },
          { question: "Fan purchased?", answer: "No, I need the pro to supply it" },
        ],
        attachments: [{ fileName: "fan.jpg", mimeType: "image/jpeg", url: fanPhoto }],
      },
      estimate: { type: "OnSite" },
      leadPrice: "$27.00",
      createdAt: "2026-09-16T18:22:00.000Z",
    },
    messages: [
      {
        messageID: "m-5122-01",
        negotiationID: "512488815602293347",
        from: "Customer",
        text: "Photo of the current fan attached.",
        attachments: [],
        sentAt: "2026-09-16T18:22:00.000Z",
      },
      {
        messageID: "m-5122-02",
        negotiationID: "512488815602293347",
        from: "Business",
        text: "Thanks Kevin. I stopped by today; quote for a Panasonic WhisperCeiling swap is on its way by email.",
        attachments: [],
        sentAt: "2026-09-19T23:45:00.000Z",
      },
      {
        messageID: "m-5122-03",
        negotiationID: "512488815602293347",
        from: "Customer",
        text: "Got it, will look this weekend.",
        attachments: [],
        sentAt: "2026-09-20T00:31:00.000Z",
      },
    ],
  },
  // Won.
  {
    stage: "won",
    lastOpenedAt: "2026-09-15T20:00:00.000Z",
    negotiation: {
      negotiationID: "512433970158820419",
      customer: {
        customerID: "418809846631170259",
        firstName: "Ruth",
        lastName: "Adler",
        phone: "+15550108842",
      },
      request: {
        description: "Gutters full of fir needles again. Single story, about 140 feet total.",
        category: { name: "Gutter Cleaning" },
        location: {
          address1: "118 N 5th Ave",
          city: "Ridgefield",
          state: "WA",
          zipCode: "98642",
        },
        details: [
          { question: "Home height", answer: "1 story" },
          { question: "Gutter length", answer: "100 - 150 ft" },
          { question: "Downspouts clogged?", answer: "Not sure" },
        ],
        attachments: [],
      },
      estimate: { type: "Fixed", total: "$220.00" },
      leadPrice: "$16.00",
      createdAt: "2026-09-12T16:05:00.000Z",
    },
    messages: [
      {
        messageID: "m-5121-01",
        negotiationID: "512433970158820419",
        from: "Customer",
        text: "Are you available next week?",
        attachments: [],
        sentAt: "2026-09-12T16:05:00.000Z",
      },
      {
        messageID: "m-5121-02",
        negotiationID: "512433970158820419",
        from: "Business",
        text: "I am. Tuesday morning, $220 including flushing the downspouts.",
        attachments: [],
        sentAt: "2026-09-12T17:30:00.000Z",
      },
      {
        messageID: "m-5121-03",
        negotiationID: "512433970158820419",
        from: "Customer",
        text: "Perfect, see you Tuesday.",
        attachments: [],
        sentAt: "2026-09-12T18:02:00.000Z",
      },
    ],
  },
  // Lost.
  {
    stage: "lost",
    lastOpenedAt: "2026-09-14T22:40:00.000Z",
    negotiation: {
      negotiationID: "512410558391076682",
      customer: {
        customerID: "418806604428731145",
        firstName: "Sam",
        lastName: "Whitaker",
        phone: "+15550105590",
      },
      request: {
        description:
          "Floating shelves in the living room, 4 of them, into drywall. Want them to hold books.",
        category: { name: "Shelf Installation" },
        location: {
          address1: "15530 SW Division St",
          city: "Beaverton",
          state: "OR",
          zipCode: "97005",
        },
        details: [
          { question: "How many shelves?", answer: "4" },
          { question: "Wall type", answer: "Drywall" },
          { question: "Shelves purchased?", answer: "Yes" },
        ],
        attachments: [],
      },
      estimate: { type: "Hourly", total: "$85.00" },
      leadPrice: "$19.25",
      createdAt: "2026-09-10T19:15:00.000Z",
    },
    messages: [
      {
        messageID: "m-5120-01",
        negotiationID: "512410558391076682",
        from: "Customer",
        text: "How long would 4 shelves take?",
        attachments: [],
        sentAt: "2026-09-10T19:15:00.000Z",
      },
      {
        messageID: "m-5120-02",
        negotiationID: "512410558391076682",
        from: "Business",
        text: "About 2 hours if the studs line up. $85 an hour.",
        attachments: [],
        sentAt: "2026-09-10T20:01:00.000Z",
      },
      {
        messageID: "m-5120-03",
        negotiationID: "512410558391076682",
        from: "Customer",
        text: "Thanks, we went with someone closer.",
        attachments: [],
        sentAt: "2026-09-14T22:38:00.000Z",
      },
    ],
  },
];
