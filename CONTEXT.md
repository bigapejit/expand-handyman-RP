# Expand Handyman

Expand Handyman prepares documents for customers to review and sign.

## Language

**Customer**:
A person receiving handyman services. Has zero or more sites; a customer can exist with no site until a proposal is needed.

**Site**:
One verified street address belonging to a customer where handyman work takes place, picked from Google's address suggestions. A customer may have many. Every proposal is for exactly one site; documents are not.
_Avoid_: Property, address, location, service address (as the name of the record)

**Site name**:
A short code built from the site's street number and street name (`1600 Amphitheatre Pkwy` becomes `1600AMPHITHEATRE`). Rebuilt when the address is corrected. Not a label the owner chooses.

**Document**:
A PDF prepared for a customer to review and sign. Belongs to the customer, never to a site.

**Signature field**:
A designated area on a document page where the customer's signature appears.

**Signing link**:
A private link that gives a customer access to a document without creating an account.

**Owner**:
The Expand Handyman staff member who prepares documents and signs in to the staff app.

**View**:
A customer opening a document through its signing link and seeing the PDF, including reopening it after signing. Only customers view; an owner opening the same link is a preview, not a view.

**Owner preview**:
The owner opening a signing link to check what the customer will see. Recorded separately and never counts as a view.

**View log**:
The record of every view and owner preview of a document: who opened it, when, and for how long.

**Signed document**:
The completed PDF containing the customer's signature, retained for later download.

**Solution**:
A proposed scope of handyman work with priced line items, planned for a later phase.

**Proposal**:
A document assembled from solutions and terms for one site, planned for a later phase.

**Proposal ID**:
The site name and the proposal's number, joined as `<Site name>-P<number>`, counted separately for each site and never reused. Fixed when the proposal is sent, so a later address correction never changes an ID the customer already holds.
