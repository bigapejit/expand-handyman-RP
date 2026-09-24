# Prototype: Pay now on the invoice link, and the paid invoice in the panel (issue #112)

Throwaway. Branch `prototype/pay-now`. Run `npm run dev` and open `/prototype/pay-now`.
Nothing here saves; every figure is made up. The purple pills at the top right flip
variants (arrow keys too) and, on the invoice link, the reading of the invoice.

## The invoice link, `/prototype/pay-now/link`

Three places Pay now could live, `?variant=A|B|C`, on the real paper screen with the
real invoice paper:

- **A Pay bar at the bottom**: a bar pinned to the bottom like the sign bar. Amount Due
  on the left, "Pay by card, $2,940.00" and "Pay by bank" on the right, one sentence
  above the row about the card fee.
- **B Choices above the paper**: a white card between the top bar and the paper,
  "Pay $2,854.37 online", with the two ways as rows: the way, what it costs, the figure.
- **C Pay button, then a sheet**: one "Pay $2,854.37" button in the top bar beside
  Download. It opens a sheet from the bottom with the same two rows.

Four readings, `?reading=`:

- `unpaid`: the deposit invoice, $2,854.37, so card is $2,940.00 with a $85.63 fee.
- `small`: a $353.93 invoice, where card is free too.
- `onway`: a bank payment accepted but not confirmed. Pay now is gone. A says it in the
  bar, B in the card, C in the strip under the top bar.
- `paid`: as today, PAID stamp and "Paid on 9/23/2026. Thank you."

Pressing a way to pay opens a stand-in for Stripe's checkout page (`?show=bank|card`
opens it directly), with the card fee as its own line. Paying there moves the page on,
in memory: bank to "Payment on its way", card to PAID.

## The signing link right after signing, `/prototype/pay-now/approved`

- **A Email only**: the banner adds "Your deposit invoice, $2,854.37, follows in a
  second email."
- **B Pay deposit in the bar**: "Pay the $2,854.37 deposit" beside "Signed by".
- **C Pay deposit in the banner**: the banner ends "Pay the $2,854.37 deposit now ›".

## The invoice panel, `/prototype/pay-now/panel` (in the staff shell, sign in as usual)

Five invoices: paid by bank through Stripe, by card through Stripe, marked by the
owner, a bank payment on its way, and one still unpaid. `?variant=A|B` for the block:

- **A One sentence**: the green box as today, "Paid Sept 23, by card through Stripe."
  with "See the payment in Stripe" under it; "Mark unpaid" only on the owner's own.
- **B A record**: "Paid Sept 23" over "By card through Stripe", the Stripe link on the
  right.

`/prototype/pay-now/panel-only` is the same without the shell, for headless screenshots.

Screenshots in this folder, made by `shoot.sh`.
