# Expand Handyman

Expand Handyman prices handyman work at a customer's site, sends the proposal for the customer to approve, and invoices the work.

## Language

**Customer**:
The person who pays for handyman work and signs its paperwork, added by the owner by hand or made by a Thumbtack lead arriving. Holds contact details; the work itself lives on their sites. Has zero or more sites, and can exist with no site until a proposal is needed. The owner looks a customer up mainly to reach their sites.

**Site**:
One verified street address belonging to a customer where handyman work takes place, picked from Google's address suggestions. The place the owner works from: solutions, proposals, invoices and photos all belong to a site, and reaching any of them from elsewhere in the app lands on the site. A customer may have many.
_Avoid_: Property, address, location, service address (as the name of the record)

**Site name**:
A short code built from the site's street number and street name, skipping a direction word between them (`1600 Amphitheatre Pkwy` becomes `1600AMPHITHEATRE`; `4410 NE 94th St` becomes `441094TH`, not `4410NE`). Rebuilt when the address is corrected. Not a label the owner chooses.

**Signing link**:
A private link that gives a customer access to a proposal without creating an account. A proposal gets a fresh one each time it is sent or re-sent, and the one before stops working. Once the customer approves or declines, the link still shows what they decided but can no longer be used to act.

**Owner**:
The Expand Handyman staff member who prices the work and sends proposals and invoices, and whose accounts the deployment pins, so they can never be removed from the Staff list.

**Staff member**:
Anyone on the Staff list, which is who can sign in to the staff app. Every staff member can do everything in it, including inviting and removing others; there are no roles. Someone removed is locked out on their next request.
_Avoid_: User, admin, team member

**Invite**:
An email from Clerk with a link to create an account, sent when a staff member adds someone's email to the Staff list. Only invited emails can create an account. The invited person waits under Waiting to sign up until they first sign in.

**View**:
A customer opening a proposal through its signing link and seeing it, including reopening it after answering. Only customers view; an owner opening the same link is a preview, not a view.

**Owner preview**:
The owner opening a signing link to check what the customer will see. Recorded separately and never counts as a view.

**View log**:
The record of every view and owner preview of a proposal: who opened it, when, and for how long. The owner reading a proposal inside the staff app is not an owner preview and is not logged.

**Photo**:
A picture the owner took at a site, kept on the site with the time it was taken. It has no caption. Only the owner sees photos.

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
An offer assembled from solutions and terms for one site. A site may have several proposals offering different sets of solutions, and the owner may mark at most one of them recommended. A proposal is draft, sent, approved or declined; approved and declined are final, and trying again means a new proposal. Approving one proposal leaves the others at the site as they are.
_Avoid_: Document, quote, estimate

**Deposit**:
The part of a proposal's total due on signing, with the rest due on completion. The owner states it either as a whole percent of the total (50% unless changed; 0% and 100% are allowed) or as a set amount that stays as typed when the total changes, and never more than the total. The deposit invoice bills it when the customer approves.
_Avoid_: Down payment, retainer

**Balance**:
What is left of a proposal's total after the Deposit, due on completion. The final invoice bills it, less anything else invoiced in between.
_Avoid_: Final payment, remainder

**Invoice**:
A request for payment that belongs to one approved proposal: its deposit invoice, its final invoice, or another invoice the owner types. A draft, sent or declined proposal has none. An invoice is a draft until sent, then sent, and void if it was wrong; whether it is paid is read from its payment, not a state of its own.
_Avoid_: Bill, statement, receipt

**Deposit invoice**:
The invoice made and sent by itself when the customer approves a proposal, for exactly the Deposit they signed for: its one line is the Deposit's share of the price before tax, and the paper adds the tax. Never a draft, and its amount is never changed. A proposal with a 0% Deposit gets none.

**Final invoice**:
The invoice the owner raises by saying the job is done. It starts with the proposal at its price before tax and one line taking off each invoice already sent on it, and the owner may add lines for materials that came in under or over and for approved extras before sending. The paper adds sales tax at the proposal's rate. One per proposal.
_Avoid_: Balance invoice, closing invoice, progress invoice

**Job done**:
The owner saying, on an approved proposal, that the work is finished. It raises the final invoice as a draft and opens it; the proposal itself does not change state. Offered only until the final invoice exists.
_Avoid_: Complete, close out, finish (as app actions)

**Invoice line**:
One entry on an invoice: a description and an amount before tax, which may be negative for a credit. The deposit invoice has one fixed line, the final invoice starts with the proposal's price and a line taking off each earlier invoice, and any other invoice's lines are all typed by the owner.
_Avoid_: Line item (a solution's, which carries a cost the customer never sees)

**Draft invoice**:
A final or typed invoice the owner is still putting together: its lines can change, it has no invoice number and the customer cannot see it. Deleting it leaves no trace.
_Avoid_: Pending invoice, unsent invoice

**Send (an invoice)**:
Emailing a draft invoice to the customer as a private link. Its lines, amounts, invoice number, date, customer name, site address, Proposal ID and the email address it went to are fixed as they stand. The paper's date is the day it was sent.
_Avoid_: Issue, post, raise (which is making one)

**Invoice number**:
`INV-` and a count that runs across the whole business from `INV-1001`, given when the invoice is sent and never reused or reset. A draft has none and a void invoice keeps its own, so the sequence has no gaps. Printed beside the Proposal ID.
_Avoid_: Invoice ID, reference

**Due date**:
The day an invoice was sent: every invoice is due on receipt and the paper says so. Overdue is read against it.
_Avoid_: Net 30, payment deadline, terms (which are the contract conditions)

**Void**:
The owner cancelling a sent invoice that was wrong, with an optional short reason the customer never sees. Refused while the invoice is marked paid. The invoice keeps its number and stays in the list struck through, its link shows the paper stamped VOID, and nobody is emailed. A voided deposit invoice is not made again; the owner types a new invoice if the money should still be billed.
_Avoid_: Cancel, delete (a draft is deleted, a sent invoice is voided), withdraw, credit note, reverse

**Re-send (an invoice)**:
Emailing a sent invoice again, to the customer's current email address, with a fresh link; the old link stops working. Nothing on the invoice changes, not even its date.

**Payment**:
The record that a sent invoice's money arrived: the day it arrived and who recorded it, the owner by hand or the app from a Pay now through Stripe. A payment the app wrote also says how the money moved, by card or by bank; one the owner recorded does not. Never edited: the owner takes their own back by marking the invoice unpaid, and a payment the app wrote cannot be taken back by hand. It is removed only when the money itself goes back, by a full refund or a lost dispute handled in Stripe.
_Avoid_: Transaction, receipt, paid tick (it is a record, not a flag on the invoice)

**Mark paid**:
The owner recording a payment on a sent invoice, with the day the money arrived, today unless changed. The customer's link then shows the paper stamped PAID with that day. Mark unpaid removes it, stamp and all. An invoice for a credit is marked paid once the owner has refunded it by hand.
_Avoid_: Settle, close, reconcile

**Standing**:
What an invoice reads about its money: Unpaid, Paid, Overdue when still unpaid more than seven days after the day it was sent, or Payment on its way while a bank payment is confirming. Read from its payment each time, never stored. A void invoice has none, and an invoice for $0 reads Paid from the moment it is sent.
_Avoid_: Status (which is draft, sent or void), state, paid flag

**Pay now**:
The customer paying a sent invoice from its link: one Pay button opens the Pay sheet. Bank and card go through Stripe's own checkout page for the full Amount Due with no fee, card only when Amount Due is $1,000 or less, and the payment then records itself on the invoice. Zelle and check are steps on the sheet and stay in How to pay on the paper; money that comes those ways is still marked paid by the owner.
_Avoid_: Payment link (the invoice link is where Pay now lives), checkout (Stripe's page, not an app concept), online payment (as the name of the action), card fee or surcharge (there is none)

**Pay sheet**:
What the Pay button on an invoice link opens: the ways to pay, each with the Amount Due. Pay by bank and Pay by card lead to Stripe; Pay by Zelle® and Pay by check turn the sheet into the steps for paying that way, naming the Zelle tag or the payee, the amount and the invoice number for the memo. Card is listed only when Amount Due is $1,000 or less.
_Avoid_: Payment options, payment methods (Stripe's word), checkout

**Zelle tag**:
The business's Zelle handle, `expandhandyman`, which a customer types in their banking app where they would type an email address. The invoice paper and the Pay sheet name it, never an email, because the business is enrolled with Zelle under the tag alone. A setting the owner edits, since the bank may change it.
_Avoid_: Zelle email, Zelle address, Zelle ID

**Payment on its way**:
The standing of a sent invoice whose bank payment Stripe has accepted but not yet confirmed, which can take a few business days. The Pay button is gone from the link meanwhile, and the invoice does not read Overdue. It reads Paid, stamp and all, once the money is confirmed.
_Avoid_: Pending, processing, awaiting payment

**Returned payment**:
A bank payment Stripe accepted that the customer's bank then refused, days later, for a reason such as insufficient funds or a closed account. Payment on its way ends, the invoice reads Unpaid or Overdue again from the day it was sent, and the Pay button is back on the link with a line saying the payment was returned. Stripe emails nobody about it, so the app does: the customer is asked to pay again, and the owner is told with the bank's reason. The invoice keeps the note until it is paid, on its way again or void.
_Avoid_: Failed payment (Stripe's word; the money was accepted, then sent back), bounced payment, declined (a card word)

**Invoice paper**:
An invoice laid out as the customer reads it, the same on screen, printed or as a PDF, on the proposal paper's letterhead: the invoice number, the sent date and Due on receipt, the customer and site with the Proposal ID, the lines before tax, then Subtotal, Sales Tax at the proposal's rate and Amount Due, and how to pay. Washington requires the tax stated separately on an invoice. No Terms page and no line about the Terms: the invoice sits under the proposal as signed. Stamped VOID in red once voided and PAID in green, with the day, once marked paid.
_Avoid_: Invoice document, invoice PDF, bill

**Paper state**:
Which sheet a sent or void invoice's paper is: sent, paid (stamped PAID) or void (stamped VOID). Every stamp changes the sheet, so an invoice's PDF copy is kept only while the invoice stays in the paper state it printed. A draft invoice has none.
_Avoid_: Invoice status (the invoice's own state is draft, sent or void, and its standing Unpaid, Paid or Overdue)

**Invoice link**:
A private link that shows one invoice's paper to the customer, sent in the invoice's email, and where Pay now lives while the invoice is unpaid. Nothing is signed through it. It never expires by itself: only a re-send ends it, and a paid or void invoice's link keeps showing the stamped paper.
_Avoid_: Signing link (for an invoice; the customer signs nothing), payment link

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
_Avoid_: Proposal document, proposal PDF

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
_Avoid_: Signed document

**Certificate of completion**:
The closing pages of a signed copy, recording how it was signed: when it was sent, first viewed and approved, by whom and from where, with a fingerprint of the offer as accepted, and the Notice to Customer on a second page when it was acknowledged.

**PDF copy**:
The proposal paper of a sent or approved proposal, or the invoice paper of a sent or void invoice, saved as a PDF file, made only when the owner or the customer asks to download it and then kept for as long as the proposal or invoice stays in that state. A draft or declined proposal has none, and neither does a draft invoice. An approved proposal's PDF copy is its signed copy as a file, and it never changes once made.
_Avoid_: Proposal PDF, proposal document, attachment

**Render pass**:
The short-lived key the PDF renderer opens a proposal or invoice paper with, instead of a signing or invoice link. Each one is made for a single PDF copy, of one proposal in one state or one invoice in one paper state (sent, paid or void), stops working within minutes, and is deleted when the render ends. Reading the paper through it is never a view and is never logged.
_Avoid_: Paper token, report token

**Lead**:
A request for work that arrived from Thumbtack: what the customer asked for and where, the category, Thumbtack's estimate and what the lead cost, kept under the customer it made or matched. A customer may have several leads; each has its own chat and its own stage. Nothing else in the app is a lead: a customer the owner adds by hand has none.
_Avoid_: Negotiation (Thumbtack's API name), opportunity, enquiry, job

**Thumbtack number**:
The phone number Thumbtack sends with a lead, saved as the customer's phone and marked as Thumbtack's, because it may be a relay number that stops working. The mark drops the moment the owner saves a different number.
_Avoid_: Proxy number, masked number

**Stage**:
Where a lead stands with the owner: New (the lead has arrived and the two sides have not yet both written), Talking (the customer has answered the owner), Booked (the visit is on the owner's calendar), Estimating (the visit is done and the owner is working out the estimate), Sent out (a proposal has been sent), Won or Lost. Thumbtack never says which, so the owner moves it, and the app moves it for them when it can: to Talking when the customer writes after the owner has, to Sent out when a proposal for that customer is sent, to Won when one is approved. The owner's message alone moves nothing, and Booked, Estimating and Lost are only ever set by hand. Won and Lost are final and leave the board.
_Avoid_: Status (Thumbtack's own, which the app cannot read), hire status, column (where a stage is shown)

**Thumbtack board**:
The staff page listing every open lead by stage, newest first, with a mark on each lead whose customer has written since the owner last opened it. Won and Lost leads are listed under Closed.
_Avoid_: Leads page, pipeline, CRM

**Thumbtack chat**:
Every message Thumbtack has delivered on one lead, the customer's and the owner's, shown read-only under the lead with when it was sent and any attachments. The app never sends a message.
_Avoid_: Thread, conversation (as the record's name), inbox

**Send message on Thumbtack**:
The one button on a lead's chat: it opens that lead's conversation on thumbtack.com in a new tab, where the owner replies. Nothing is sent by the app.
_Avoid_: Reply, send (as an app action)

**Unread**:
A lead whose customer has written since the owner last opened it in the app. Cleared by opening the lead; nothing that happens on Thumbtack clears it.
_Avoid_: New message flag, notification
