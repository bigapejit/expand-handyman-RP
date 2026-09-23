# Expand Handyman

Expand Handyman prepares documents for customers to review and sign.

## Language

**Customer**:
A person receiving handyman services. Has zero or more sites; a customer can exist with no site until a proposal is needed.

**Site**:
One verified street address belonging to a customer where handyman work takes place, picked from Google's address suggestions. A customer may have many. Every proposal is for exactly one site; documents are not.
_Avoid_: Property, address, location, service address (as the name of the record)

**Site name**:
A short code built from the site's street number and street name, skipping a direction word between them (`1600 Amphitheatre Pkwy` becomes `1600AMPHITHEATRE`; `4410 NE 94th St` becomes `441094TH`, not `4410NE`). Rebuilt when the address is corrected. Not a label the owner chooses.

**Document**:
A PDF prepared for a customer to review and sign. Belongs to the customer, never to a site.

**Signature field**:
A designated area on a document page where the customer's signature appears.

**Signing link**:
A private link that gives a customer access to a document or a proposal without creating an account. A proposal gets a fresh one each time it is sent or re-sent, and the one before stops working. Once the customer approves or declines, the link still shows what they decided but can no longer be used to act.

**Owner**:
The Expand Handyman staff member who prepares documents and signs in to the staff app.

**View**:
A customer opening a document or proposal through its signing link and seeing it, including reopening it after signing. Only customers view; an owner opening the same link is a preview, not a view.

**Owner preview**:
The owner opening a signing link to check what the customer will see. Recorded separately and never counts as a view.

**View log**:
The record of every view and owner preview of a document or proposal: who opened it, when, and for how long. The owner reading a proposal inside the staff app is not an owner preview and is not logged.

**Signed document**:
The completed PDF containing the customer's signature, retained for later download.

**Solution**:
One priced piece of handyman work at a site: a title, a scope of work and its line items. Its price is never typed; it is worked out from the line items and the markup, rounded up to the whole dollar, plus any material allowance. A solution with neither line items nor a material allowance has no price, which is different from a price of $0.
_Avoid_: Option, estimate, task, job

**Line item**:
One entry in a solution: a name, a quantity, a unit (each, square foot, linear foot, hour, day or week) and a unit cost. The unit cost is what the work costs the owner, not what the customer pays. Customers see the name, quantity and unit, never the cost.
_Avoid_: Rate, cost line, labor entry

**Markup**:
The percentage added to a solution's cost to reach its price. 10% unless the owner sets a different whole percent for that one solution. Internal only: the customer sees the price, never the markup.
_Avoid_: Margin, profit %, fee

**Material allowance**:
A solution's one optional dollar amount for materials that can only be estimated when the work is priced. Added to the solution's price as typed, with no markup, and printed on the proposal paper with its amount. Settled to the actual cost later: the customer is credited what the materials come in under, and approves in writing before they go over.
_Avoid_: Allowance line item, materials budget

**Catalog**:
The memory of line items the owner has typed before, offered as suggestions while typing a new one. A convenience, not a price list: a suggestion taken becomes an ordinary line item with no tie back to the catalog.
_Avoid_: Price book, price list, rate card

**Proposal**:
An offer assembled from solutions and terms for one site, planned for a later phase. A site may have several proposals offering different sets of solutions, and the owner may mark at most one of them recommended. A proposal is draft, sent, approved or declined; approved and declined are final, and trying again means a new proposal. Approving one proposal leaves the others at the site as they are.
_Avoid_: Document (an uploaded PDF, a different thing), quote, estimate

**Deposit**:
The part of a proposal's total due on signing, with the rest due on completion. The owner states it either as a whole percent of the total (50% unless changed; 0% and 100% are allowed) or as a set amount that stays as typed when the total changes, and never more than the total. The proposal only states these payment terms; payments are not recorded.
_Avoid_: Down payment, retainer

**Balance**:
What is left of a proposal's total after the Deposit, due on completion.
_Avoid_: Final payment, remainder

**Invoice**:
A request for payment that belongs to one approved proposal: a deposit invoice, an advance invoice, a progress invoice or the final invoice. A draft, sent or declined proposal has none. A new invoice may be raised while an earlier one is unpaid.
_Avoid_: Bill, statement, receipt

**Deposit invoice**:
The invoice made by itself when the customer approves a proposal, for exactly the Deposit they signed for. Its amount is never changed. A proposal with a 0% Deposit gets none. Counts as money On account.

**Advance invoice**:
An invoice for a set amount the owner types, asked for ahead of any solution being done, for when a long job needs money before its first solution is finished. Never more than what is Left to bill. Counts as money On account.
_Avoid_: Partial invoice, interim invoice

**On account**:
Everything invoiced ahead of work done, the deposit and any advances, whether paid yet or not. Taken off the progress and final invoices, oldest first, until used up, and printed on each as "less on account".
_Avoid_: Credit (which is what the customer is owed back), prepayment

**Progress invoice**:
An invoice for the solutions the owner ticks as done, each at the price the customer signed for, with any material allowance replaced by its settlement; nothing is typed but real materials costs. A solution is ticked on one invoice only. Whatever is On account comes off it. Made even when nothing is left due, as the record of what was done.
_Avoid_: Partial invoice, interim invoice, per-solution invoice

**Final invoice**:
The progress invoice that ticks the last solution done. It also carries the approved extras and, when more was On account than the work came to, shows the credit the owner owes back and refunds by hand. One per proposal.
_Avoid_: Balance invoice, closing invoice, final payment (a payment is money in, not the request)

**Left to bill**:
The price of every solution not yet ticked done, less its unsettled material allowance, plus the real cost of every settled one, less what is On account and not yet used up. An advance invoice never goes past it.
_Avoid_: Remaining, outstanding (which is about payment, not billing)

**Allowance settlement**:
Replacing a material allowance with what its materials really cost, typed when its solution is ticked done. Printed on that invoice as the allowance, the real cost and the difference either way; a credit when under, an overage when over. The written approval the Terms require before going over is the owner's to hold; nothing checks it.
_Avoid_: Reconciliation, true-up

**Approved extra**:
Work outside the signed proposal that the customer approved in writing under the Terms' Changes clause, billed on the final invoice as a description and an amount. It never changes the proposal's total.
_Avoid_: Change order, add-on, upcharge

**Adjustment**:
An allowance settlement or an approved extra: the lines that move an invoice away from the signed price.

**Fully billed**:
A proposal whose final invoice exists. Nothing more is invoiced on it: a forgotten extra means voiding the final invoice and making it again, and a change found later is a new proposal.
_Avoid_: Closed, complete, paid (payment is a different question)

**Proposal ID**:
The site name and the proposal's number, joined as `<Site name>-P<number>`, counted separately for each site and never reused. Fixed when the proposal is sent, so a later address correction never changes an ID the customer already holds.

**Send**:
Offering a draft proposal to the customer by email. Its solutions, prices, tax, terms, notes, Proposal ID, Estimator, customer name, site address and the email address it went to are fixed as they stand, so later edits to a solution, the customer or the site change only drafts. Refused while the proposal has no solutions, has an unpriced solution, has no tax rate, asks for a Deposit larger than its total, or the customer has no email address. An email that fails to go out does not undo the send.
_Avoid_: Issue, publish

**Withdraw**:
The owner taking back a sent proposal: its signing link stops working, the fixed offer is discarded and it becomes a draft again. The customer is not told.

**Re-send**:
Sending the same fixed offer again, to the customer's current email address, with a fresh signing link. Used when the email was lost or went to the wrong address.

**Approve**:
The customer accepting a sent proposal through its signing link, which forms the agreement. The customer and the owner each get an email with the link to the signed proposal.
_Avoid_: Accept, sign (on their own, for a proposal)

**Decline**:
A sent proposal being turned down, either by the customer through its signing link, with an optional reason, or by the owner on the customer's behalf. Only a decline through the link emails the owner.

**Opened**:
A sent proposal whose current signing link the customer has viewed at least once. Read from the view log; not a state of the proposal.

**Proposal paper**:
A proposal laid out as the customer reads it, the same on screen, printed or as a PDF: letterhead, cover details, an opening letter with the total and the two signature lines, one section per solution listing its line items and scope of work with no prices except the amount of a material allowance, the grand total with payment terms and tax, and the terms in full.
_Avoid_: Proposal document (a document is an uploaded PDF), proposal PDF

**Terms**:
Expand Handyman's one fixed set of contract conditions (scope, payment, changes, warranty, cancellation and the rest), the same on every proposal and printed in full on the proposal paper. Nobody edits them per proposal, and sending fixes the wording the customer signs under.
_Avoid_: Terms of use (the website's), fine print

**Notes and exclusions**:
The owner's free text for one proposal: what the job leaves out or depends on. Printed as a paragraph of the opening letter, and absent when empty.

**Estimator**:
The person the proposal paper names as having prepared the offer and as the one to call with questions: the owner who sends the proposal, under the name and email on their sign-in account at that moment, with the business's phone. The letterhead keeps the business's own email.

**Notice to Customer**:
Washington's required contractor disclosure: registration, bond and lien rights. A customer approving a proposal of $1,000 or more also acknowledges receiving it, and the wording they acknowledged is kept with the signed copy.

**Signed copy**:
The proposal paper of an approved proposal: the customer's typed name on their signature line, followed by the certificate of completion.
_Avoid_: Signed document (a signed uploaded PDF, a different thing)

**Certificate of completion**:
The closing pages of a signed copy, recording how it was signed: when it was sent, first viewed and approved, by whom and from where, with a fingerprint of the offer as accepted, and the Notice to Customer on a second page when it was acknowledged.

**PDF copy**:
The proposal paper of a sent or approved proposal saved as a PDF file, made only when the owner or the customer asks to download it and then kept for as long as the proposal stays in that state. A draft or declined proposal has none. An approved proposal's PDF copy is its signed copy as a file, and it never changes once made.
_Avoid_: Proposal PDF, proposal document, attachment

**Render pass**:
The short-lived key the PDF renderer opens a proposal paper with, instead of a signing link. Each one is made for a single PDF copy, of one proposal in one state, stops working within minutes, and is deleted when the render ends. Reading the paper through it is never a view.
_Avoid_: Paper token, report token
