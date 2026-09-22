# PROTOTYPE: FRSG shell on Expand (wayfinder ticket #21)

Throwaway. Answers "Prototype the FRSG shell on Expand" (#21) on map #8: does
FRSG's staff shell, ported verbatim with Expand's logo and the nav agreed in #14,
look right, and which deviations from FRSG does the owner want?

## What is real and what is stub

- Real: the shell (stock shadcn Sidebar, 56px header, "Staff console"), Geist,
  PageHeader, IndexRow, SidePanel with `?proposal=` in the URL, the owner gate,
  Clerk sign-in, the customers and documents from the dev Convex deployment.
- Stub (`lib/prototype-hub.ts`, `components/use-customer.ts`): four made-up
  customers (ids `stub-*`), every site, solution and proposal. No button writes
  anything. Dashboard and the global Proposals page are placeholders; the global
  Documents page is the old list, not re-skinned.
- No Convex functions were added or deployed.

## Run it

```
cp ../path/to/main/.env.local .     # dev Clerk + dev Convex
npm ci
npx next dev --port 3217
node --env-file=.env.local scripts/prepare-browser-test.mjs   # prints a sign-in ticket for port 3210; swap the port
```

Then open `/customers` and `/customers/stub-maria/proposals?proposal=stub-maria-p1`.

## Screenshots

1. `1-customers-desktop.png`: Customers index
2. `2-customer-page-desktop.png`: customer page, Proposals tab
3. `3-proposal-panel-sent-desktop.png`: SidePanel on a Sent proposal
4. `4-customers-mobile.png`: Customers index at 390px
5. `5-sidebar-mobile.png`: the sidebar as a sheet at 390px
6. `6-proposal-panel-draft-mobile.png`: SidePanel on a Draft at 390px
