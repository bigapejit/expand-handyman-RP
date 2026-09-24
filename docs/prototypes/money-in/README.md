# Prototype: money landing in the bank, matched to invoices (ticket #130)

Throwaway. Branch `prototype/money-in`. Run `npm run dev`, sign in, and open
`/money-in`. Nothing here saves and every figure is made up; reload to start over.
The purple pills at the top right flip the variant (arrow keys too), the mode, and
whether Relay needs a login. `?bar=off` hides them for a screenshot.

The banks, as the map settled them on 2026-09-24: Zelle lands at U.S. Bank; checks,
transfers and Stripe payouts land in Relay. So a Zelle match reads "by Zelle landed in
U.S. Bank" and a check "by check landed in Relay".

## Three homes, `?variant=A|B|C`

- **A · Money in page.** Its own page in the nav, with a green count of what is
  waiting. Waiting deposits on top, done ones (matched, set aside, Stripe payouts)
  under a "Done" heading. The most screens; also the only one with a history.
- **B · On Invoices.** Nothing new in the nav; the count sits on Invoices. A deposit
  that fits an invoice shows as a strip under that invoice's row in Unpaid, with
  Confirm right there. Deposits that fit nothing are one blue line above the list that
  opens a fifth segment, "Money in", holding the full list as in A.
- **C · Dashboard card.** A "Money landed" card at the top of the Dashboard and
  nothing else. Only what is waiting shows; a deposit leaves the card once it is on an
  invoice or set aside, and lives on the invoice from then on. Stripe payouts are one
  grey line under the card. Fewest screens: no page, no segment, no history.

## Two modes, `?mode=confirm|auto`

- **Suggest, you confirm** (default): every deposit waits for a tap.
- **Marks itself, Undo**: a deposit with exactly one open invoice for its amount is
  marked paid by itself when it lands; the row reads "Marked paid by itself" with Undo,
  and the invoice's panel has "Not this invoice". Everything else still waits.

## The seven deposits

| Deposit | What the app does |
| --- | --- |
| $2,854.37 Zelle from Whitfield Dana, memo INV-1001 | One open invoice for the amount: **Confirm** |
| $500.00 Zelle from Alvarez Maria | Two invoices for $500; the name fits Alvarez, so she is first and black: **This one** |
| $1,240.00 mobile check | Fits nothing: **Pick an invoice** (nearest amount first, tick two if it paid both) or **Not an invoice** |
| $1,950.00 Zelle from Patel Raj | Two of Raj's add up to it: **Confirm both** |
| $980.00 mobile check | INV-1002 is for the amount but was marked paid by hand Sept 18: **Attach** or **Leave it** |
| $5,000.00 transfer from CHK 4412 | The owner's own money: **Not an invoice** |
| $86.13 Home Depot refund | Not customer money: **Not an invoice** |

Plus a $3,102.11 Stripe payout, set aside by the app ("already counted"), and a Zelle
matched last week so the Done list has a row.

## The invoice panel

Any invoice opens the panel (`?invoice=`). Its Payment block reads:

- Matched: "Paid Sept 23, by Zelle landed in U.S. Bank." over the bank's own line and
  amount, with **Not this invoice**. A pair adds "together with INV-1005".
- Attached to an invoice marked by hand: "Paid Sept 18, marked by you." with the check
  as a second line and **Detach the deposit**.
- Marked by hand: "Paid Sept 18, marked by you." with Mark unpaid, as Pay now (#121) writes it.
- Unpaid with a deposit that fits: the offer and its Confirm sit above Mark paid.

## Relay needs a login, `?relay=login`

One amber line, "Relay needs a login again. Nothing new from it since Sept 21." and a
Reconnect button (which would open Plaid's Hosted Link). Top of the page in A and B,
inside the card in C.

## Files

`app/(shell)/money-in/page.tsx`, `components/prototype-money-in/*`,
`components/prototype/prototype-switcher.tsx`, and the "Money in" item and badges in
`components/app-sidebar.tsx`. Screenshots in this folder.
