# Prototype: proposals first

Throwaway. Branch `prototype/proposals-first`. The owner said "I only really think
of stuff in proposals", so this tries a much smaller app: three places and More, the
home page is the proposals, and one page holds a whole job.

## Run it

Copy `.env.local` from a worktree on the shared dev deployment, `npm ci`, then
`npx next dev --port 3216`. Sign in with
`node --env-file=.env.local scripts/prepare-browser-test.mjs` (swap 3210 for your port
in the URL it writes). Never run `npx convex dev` for this: it only reads queries
that already exist.

- `/` the home page, variant A (by stage)
- `/?variant=B` variant B (whose move)
- `/proposals/<id>` one proposal (open any row)
- `?bar=off` hides the purple PROTOTYPE pill

## What changed

- **Nav:** Proposals (`/`), Leads (Thumbtack, unread badge kept), Money (Invoices).
  Customers, Sites, Documents and Staff sit under More: a fold in the sidebar, a
  sheet from the phone's fourth tab.
- **Home, A, by stage:** Drafts to finish, Waiting on the customer, Approved · work
  to do, and a folded Done & declined. Each row: customer, street · title, total, and
  one plain hint ("Viewed 2× · sent 3 days ago", "Deposit $500 not paid yet",
  "$445.50 overdue"). Above it, what is owed and what is late, linking to Money.
- **Home, B, whose move:** one list of what the owner has to do, most urgent first,
  each with its verb ("Chase payment", "Send it", "Nudge them", "Job done? Invoice
  it"), then Waiting on them, then Done folded.
- **Proposal page:** status line, customer and address with Call, Text and
  Directions, the solutions with their prices and scope, a big total and the deposit
  split, the one next action, then the invoices. Photos, the paper, the site and the
  customer are small links at the bottom.

## Real and fake

Real: every figure (from `proposals.list`, `proposals.dashboard`, `sites.list`,
`invoices.list`, `proposals.forSite`, `proposals.paper`, `sites.get`,
`customers.list`, stitched together in the browser); New proposal (makes a real draft
with `proposals.create` and opens it); Send proposal; Copy the link; the invoices
block (Job done, New invoice) and the invoice panel.

Handed off to the existing screens: changing a draft's solutions or deposit, and
Re-send, Withdraw or Mark declined, open the old proposal panel on the site page. A
brand-new customer still starts on Customers.

If the shared dev backend is behind this code, the invoice panel says so and offers
the invoice paper instead of crashing the page.

## Screenshots

Desktop (1280 wide): `home-A-desktop.png`, `home-B-desktop.png`,
`proposal-draft-desktop.png`, `proposal-approved-desktop.png`. Phone (412 × 915):
`home-A-phone.png`, `more-sheet-phone.png`, `new-proposal-phone.png`,
`proposal-draft-phone.png`, `proposal-approved-phone.png`. The dev data is thin and
synthetic, so most rows read "PDF check (synthetic)".
