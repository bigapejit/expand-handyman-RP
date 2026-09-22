// PROTOTYPE (issue #22): throwaway. A dummy proposal of two solutions, as the
// frozen copy Send would make. Nothing here is read from Convex.

import { WashingtonNoticeToCustomer, signingConsentWording } from "./expand-business";

export type LineItem = { name: string; quantity: number; unit: string };
export type PaperSolution = {
  solutionId: string;
  title: string;
  lineItems: LineItem[];
  scopeOfWork: string;
};

export type PaperSignature = {
  signerName: string;
  signerTitle?: string;
  signedAt: number;
  firstOpenedAt?: number;
  networkAddress?: string;
  userAgent?: string;
  consentWording: string;
  consentWordingVersion: string;
  noticeShown: boolean;
  notice?: { wording: string; version: string };
  fingerprint: string;
};

export type PaperProposal = {
  number: number;
  name: string;
  state: "draft" | "sent" | "approved";
  recommended: boolean;
  sentAt: number;
  estimatorName: string;
  customerName: string;
  customerEmail: string;
  site: { name: string; street: string; city: string };
  solutions: PaperSolution[];
  notes?: string;
  subtotalCents: number;
  taxRate: number;
  taxCents: number;
  totalCents: number;
  depositPercent: number;
  signature?: PaperSignature;
};

export const sentAt = Date.UTC(2026, 8, 22, 17, 42, 10);

const faucet: PaperSolution = {
  solutionId: "s1",
  title: "Replace kitchen faucet and shut-off valves",
  lineItems: [
    { name: "Pull-down kitchen faucet, single handle, stainless", quantity: 1, unit: "EA" },
    { name: "Quarter-turn angle stop valve, 1/2 in x 3/8 in", quantity: 2, unit: "EA" },
    { name: "Braided stainless supply line, 20 in", quantity: 2, unit: "EA" },
    { name: "Plumbing labor", quantity: 3, unit: "HR" },
  ],
  scopeOfWork: [
    "Shut off water at the main, remove the existing faucet and both under-sink shut-off valves, and haul them away.",
    "Install two new quarter-turn angle stops and braided supply lines, then mount and connect the new pull-down faucet supplied by Expand Handyman.",
    "Restore water, test for leaks at every joint under pressure, flush the aerator and confirm hot and cold are on the correct sides.",
  ].join("\n"),
};

const drywall: PaperSolution = {
  solutionId: "s2",
  title: "Repair and repaint hallway drywall",
  lineItems: [
    { name: "Drywall repair, patches up to 12 in", quantity: 48, unit: "SF" },
    { name: "Joint compound, tape and primer", quantity: 1, unit: "EA" },
    { name: "Interior paint, eggshell, color matched (gallon)", quantity: 2, unit: "EA" },
    { name: "Carpentry and finishing labor", quantity: 7, unit: "HR" },
  ],
  scopeOfWork: [
    "Protect the floor and nearby furniture with drop cloths and plastic sheeting.",
    "Cut out and patch the damaged drywall along the hallway (about 48 square feet), tape, apply three coats of compound and sand smooth.",
    "Prime the repaired areas and apply two coats of color-matched eggshell paint to the full hallway walls, corner to corner, so no patch shows.",
    "Clean up daily and remove all debris at completion.",
  ].join("\n"),
};

const smallFix: PaperSolution = {
  solutionId: "s3",
  title: "Rehang sticking bedroom door",
  lineItems: [
    { name: "Hinge screws, 3 in", quantity: 6, unit: "EA" },
    { name: "Carpentry labor", quantity: 1.5, unit: "HR" },
  ],
  scopeOfWork:
    "Reset the top hinge with 3 in screws into the framing, plane the latch edge where it rubs, and seal the planed edge.",
};

const smallFix2: PaperSolution = {
  solutionId: "s4",
  title: "Replace bathroom exhaust fan cover",
  lineItems: [
    { name: "Exhaust fan grille, universal", quantity: 1, unit: "EA" },
    { name: "Handyman labor", quantity: 1, unit: "HR" },
  ],
  scopeOfWork: "Remove the cracked grille, clean the fan housing and blades, and fit the new grille.",
};

const base = {
  number: 1,
  name: "Kitchen faucet and hallway repair",
  recommended: true,
  sentAt,
  estimatorName: "Andrew Putilin",
  customerName: "Dana Whitfield",
  customerEmail: "dana.whitfield@example.com",
  site: { name: "3107KAUFFMAN", street: "3107 Kauffman Ave", city: "Vancouver, WA 98660" },
  notes:
    "Excludes moving large furniture, any plumbing beyond the under-sink shut-off valves, and repainting ceilings or trim. If rot is found behind the hallway drywall we will stop and price the repair with you before continuing.",
  depositPercent: 50,
  taxRate: 0.087,
} as const;

function priced(subtotalCents: number, taxRate: number) {
  const taxCents = Math.round(subtotalCents * taxRate);
  return { subtotalCents, taxRate, taxCents, totalCents: subtotalCents + taxCents };
}

export function proposalFor(variant: string): PaperProposal {
  if (variant === "small") {
    return {
      ...base,
      state: "sent",
      name: "Door and fan fixes",
      recommended: false,
      notes: undefined,
      solutions: [smallFix, smallFix2],
      ...priced(38_900, base.taxRate),
    };
  }
  return {
    ...base,
    state: variant === "preview" ? "draft" : variant === "approved" ? "approved" : "sent",
    solutions: [faucet, drywall],
    ...priced(168_400, base.taxRate),
    signature: variant === "approved" ? approvedSignature(true) : undefined,
  };
}

export function approvedSignature(noticeShown: boolean, signerName = "Dana Whitfield"): PaperSignature {
  return {
    signerName,
    signedAt: Date.UTC(2026, 8, 23, 2, 14, 51),
    firstOpenedAt: Date.UTC(2026, 8, 22, 19, 3, 27),
    networkAddress: "73.221.48.190",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
    consentWording: signingConsentWording(1),
    consentWordingVersion: "2026-09-02",
    noticeShown,
    notice: noticeShown
      ? { wording: WashingtonNoticeToCustomer.text, version: WashingtonNoticeToCustomer.version }
      : undefined,
    fingerprint: "9f3c2a71e04b8d56c1a9e7f20b3d4c5e6f718293a4b5c6d7e8f90123456789ab",
  };
}
