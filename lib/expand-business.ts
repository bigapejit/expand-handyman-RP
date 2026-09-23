// Expand Handyman's own facts, as the proposal paper prints them: FRSG's
// shared/frsg-business.ts and lib/frsg-letterhead.ts in one file, filled from
// "Supply Expand Handyman letterhead details and proposal Terms wording" (#13)
// and approved on the proposal paper prototype (#22). Code constants, not
// settings: nobody edits them in the app, and changing one is a commit.

// A fact Expand has not supplied yet. It prints as itself, because a visible
// gap on a customer's page is what gets a fact filled in.
export const Unknown = "<unknown>";

export const ExpandBusiness = {
  letterheadName: "Expand Handyman LLC",
  company: "Expand Handyman",
  serviceArea: "Vancouver, WA - Clark County",
  phone: "(564) 203-8721",
  email: "contact@expandhandyman.com",
  fedId: "42-3846714",
  waUbi: "606 261 044",
  // The UBI stands in the registration slot until the L&I contractor
  // registration number and its expiry are found (#24). Changing any of these
  // three changes the Notice to Customer, so bump NoticeToCustomerVersion too.
  waContractorRegistration: "606 261 044",
  waContractorBond: "$30,000",
  waRegistrationExpires: Unknown,
};

// The block under the company name on every sheet: where Expand works, how to
// reach it, and its registrations. No street address.
export function letterheadContactLines(): string[] {
  return [
    ExpandBusiness.serviceArea,
    `Ph: ${ExpandBusiness.phone} - ${ExpandBusiness.email}`,
    `WA UBI: ${ExpandBusiness.waUbi} - Fed ID # ${ExpandBusiness.fedId}`,
  ];
}

// The **Terms** (CONTEXT.md): the 11 clauses approved on #13, as
// [heading, body] pairs, printed in full on the paper's Terms and Conditions
// page.
export const ExpandProposalTerms: readonly (readonly [string, string])[] = [
  [
    "Acceptance.",
    "Signing this proposal accepts it as a contract between you and Expand Handyman LLC for the work described in the accepted solutions, at the prices shown. Prices are valid for 30 days from the proposal date.",
  ],
  [
    "Scope.",
    "We will do the work described in each accepted solution's scope of work and nothing else. Anything listed under Notes and exclusions, and anything not described, is not included.",
  ],
  [
    "Price and payment.",
    "The total includes Washington sales tax where shown. Payment is due as set out in the Payment Terms on this proposal. Balances unpaid 15 days after the due date accrue 1% interest per month.",
  ],
  [
    "Changes.",
    "If you ask for extra work, or we find conditions that were hidden when we priced the job (for example rot, water damage, pests, wiring or plumbing not to code), we will stop, describe the change and its price in writing, and proceed only when you approve it.",
  ],
  [
    "Scheduling and access.",
    "We will agree start and finish dates with you and tell you promptly if they move. You will give us access to the work area, water and power, and clear the area of belongings before we start.",
  ],
  [
    "Materials and permits.",
    "We supply the materials described unless the proposal says you will. Where a permit is required we will say so in the proposal; permit fees are extra unless included.",
  ],
  [
    "Warranty.",
    "We warrant our workmanship for one year from completion and will repair defects in it at no charge. Materials carry their manufacturers' warranties only. The warranty does not cover normal wear, misuse, later work by others, or pre-existing conditions.",
  ],
  [
    "Cancellation.",
    "You may cancel before work starts by telling us in writing; we will refund any deposit less the cost of materials already ordered for your job. Either party may end the contract if the other fails to meet it and does not fix the failure within 7 days of written notice.",
  ],
  [
    "Responsibility.",
    "We carry general liability insurance and are registered with Washington State Labor and Industries. Our liability for any claim is limited to the price of the work in question.",
  ],
  [
    "Disputes.",
    "Washington law applies. We will try to settle any dispute by talking first; unresolved disputes go to the courts of Clark County, Washington.",
  ],
  [
    "Whole agreement.",
    "This proposal, its accepted solutions, Payment Terms, Notes and exclusions, and these Terms are the whole agreement and replace any earlier discussion.",
  ],
];

// Which wording of the Notice to Customer a signature acknowledged. Bumped
// whenever the notice text or the facts it is filled from change, so an old
// acknowledgement still names the wording its signer was shown.
export const NoticeToCustomerVersion = "rcw-18.27.114:2026-09-22";

// Washington's statutory disclosure (RCW 18.27.114), in FRSG's wording, filled
// from Expand's facts.
export const WashingtonNoticeToCustomer = {
  version: NoticeToCustomerVersion,
  title: "NOTICE TO CUSTOMER",
  acknowledgement: "I have received a copy of this disclosure statement.",
  text: [
    `This contractor is registered with the state of Washington, registration no. ${ExpandBusiness.waContractorRegistration}, and has posted with the state a bond or deposit of ${ExpandBusiness.waContractorBond} for the purpose of satisfying claims against the contractor for breach of contract including negligent or improper work in the conduct of the contractor's business. The expiration date of this contractor's registration is ${ExpandBusiness.waRegistrationExpires}.`,
    "THIS BOND OR DEPOSIT MIGHT NOT BE SUFFICIENT TO COVER A CLAIM THAT MIGHT ARISE FROM THE WORK DONE UNDER YOUR CONTRACT.",
    `This bond or deposit is not for your exclusive use because it covers all work performed by this contractor. The bond or deposit is intended to pay valid claims up to ${ExpandBusiness.waContractorBond} that you and other customers, suppliers, subcontractors, or taxing authorities may have.`,
    "FOR GREATER PROTECTION YOU MAY WITHHOLD A PERCENTAGE OF YOUR CONTRACT.",
    "You may withhold a contractually defined percentage of your construction contract as retainage for a stated period of time to provide protection to you and help insure that your project will be completed as required by your contract.",
    "YOUR PROPERTY MAY BE LIENED.",
    "If a supplier of materials used in your construction project or an employee or subcontractor of your contractor or subcontractors is not paid, your property may be liened to force payment and you could pay twice for the same work.",
    'FOR ADDITIONAL PROTECTION, YOU MAY REQUEST THE CONTRACTOR TO PROVIDE YOU WITH ORIGINAL "LIEN RELEASE" DOCUMENTS FROM EACH SUPPLIER OR SUBCONTRACTOR ON YOUR PROJECT.',
    "The contractor is required to provide you with further information about lien release documents if you request it. General information is also available from the state Department of Labor and Industries.",
  ].join("\n\n"),
};
