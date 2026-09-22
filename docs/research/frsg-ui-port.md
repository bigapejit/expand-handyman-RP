# FRSG staff shell and UI kit: inventory for a verbatim port

Resolves wayfinder ticket #9 (map #8). Question: which files in FRSG's staff
web app make up the staff shell and UI kit, what they depend on, what is
roofing-specific in them, and what in this repo each one supersedes.

Sources are the files themselves. FRSG paths below are relative to
`apps/web/` in the shallow clone at `C:/Users/andyp/AppData/Local/Temp/frsg-app`
(https://github.com/bigapejit/frsg-app, `main` at `6e9768df2a6f`). Expand paths
are relative to this repo's root. Where "stock shadcn" is claimed, it was
checked against the base-nova registry item at
`https://ui.shadcn.com/r/styles/base-nova/<name>.json`.

## The one-paragraph answer

The shell is three files: the stock shadcn `components/ui/sidebar.tsx`, a
110-line `components/app-sidebar.tsx` that fills it with a nav array, and a
23-line `app/(shell)/layout.tsx` that wraps every staff page in
`SidebarProvider` + `SidebarInset` with a 56px (`h-14`) header. The kit is six
small components (`PageHeader`, `SidePanel`/`useSidePanel` + `lib/side-panel.ts`,
`IndexRow`/`IndexEmptyState`, `ProposalStateChip`, `Segmented`,
`CopyLinkButton`) that lean on four stock shadcn primitives Expand does not yet
have (`sheet`, `tooltip`, `skeleton`, `sidebar`; `popover` only if the footer
popover is kept) plus the three it already has byte-for-byte (`button`,
`input`, `separator`). `globals.css` is the same generated shadcn neutral theme
Expand already has, minus Expand's brand overrides and plus ~150 lines of
roof-report CSS to leave behind. There is no package to add: every kit
dependency is already in Expand's `package.json`. `react-day-picker`,
`ionicons`, `posthog-js` and `@vis.gl/react-google-maps` are FRSG-only and stay
out. Fonts: Geist and Geist Mono come through `next/font/google` in the root
layout (a two-line addition); Tinos and Homemade Apple are the *paper's* faces,
not the shell's, and Expand already ships Homemade Apple.

## Shell

### `components/ui/sidebar.tsx`

- Purpose: the stock shadcn base-nova Sidebar. 724 lines, unmodified apart from
  importing `cn` from `@/lib/utils` instead of the registry's `cn` package.
  Constants `SIDEBAR_WIDTH = "16rem"`, `SIDEBAR_WIDTH_MOBILE = "18rem"`,
  `SIDEBAR_WIDTH_ICON = "3rem"`, `SIDEBAR_KEYBOARD_SHORTCUT = "b"`, cookie
  `sidebar_state` for seven days. `Sidebar` defaults to `side="left"`,
  `variant="sidebar"`, `collapsible="offcanvas"`; when `useIsMobile()` is true
  it renders inside a `Sheet`.
- Exports: `Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInput, SidebarInset, SidebarMenu, SidebarMenuAction, SidebarMenuBadge,
  SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, SidebarMenuSub,
  SidebarMenuSubButton, SidebarMenuSubItem, SidebarProvider, SidebarRail,
  SidebarSeparator, SidebarTrigger, useSidebar`.
- Packages: `@base-ui/react/merge-props`, `@base-ui/react/use-render`,
  `class-variance-authority`, `lucide-react` (`PanelLeftIcon`). All in Expand.
- Files: `@/hooks/use-mobile`, `@/lib/utils`, `@/components/ui/button`,
  `@/components/ui/input`, `@/components/ui/separator`, `@/components/ui/sheet`,
  `@/components/ui/skeleton`, `@/components/ui/tooltip`. Matches the registry's
  `registryDependencies: button, input, separator, sheet, skeleton, tooltip,
  use-mobile`.
- CSS it assumes: the `--color-sidebar*` tokens (already in Expand's
  `globals.css`) and the `no-scrollbar` utility, which comes from
  `@import "shadcn/tailwind.css"` (`node_modules/shadcn/dist/tailwind.css`
  line 88, `@utility no-scrollbar`). Expand already imports that file.
- Roofing bits: none.
- Supersedes: the hand-rolled `<aside>` grid in Expand's
  `components/staff-shell.tsx` (`md:grid-cols-[224px_1fr]`, sticky aside,
  horizontal nav on mobile). Copy verbatim; `npx shadcn add sidebar` would
  produce the same file but with `import { cn } from "cn"`.

### `components/app-sidebar.tsx`

- Purpose: fills the Sidebar. A `navigation` array of
  `{ title, href, icon, capability? }`, active state by
  `pathname === "/"` for Dashboard and `pathname.startsWith(href)` for the
  rest, header text `FRSG` in `text-base font-semibold tracking-tight`,
  footer `<SidebarCard />`. Export: `AppSidebar`.
- Packages: `convex/react` (`useConvexAuth`, `useQuery`), `next/link`,
  `next/navigation`, `lucide-react`.
- Files: `@convex/api` (`api.staffRoles.viewerAccess`),
  `@shared/staff-access` (`StaffCapability` type), `@/components/sidebar-card`,
  `@/components/ui/sidebar`.
- Roofing/FRSG bits to strip: every nav item except Dashboard and Customers
  (Staff, Sites, Deals, FRSG line, Releases, Service Area); the `capability`
  filter and the `viewerAccess` query (owner-only here, no roles); the
  `SidebarCard` footer (on-call rota, see below); the word `FRSG`.
- What Expand puts in: nav `Dashboard, Customers, Sites, Proposals, Documents`
  (map #8), `Brand` in the header instead of the text, and a footer that
  replaces `SidebarCard` with the parts Expand needs from it: name, Sign out,
  and Clerk's account door (`useClerk().signOut`, `openUserProfile`), or
  simply Clerk's `UserButton`, which is what `staff-shell.tsx` uses today.
- Supersedes: the nav loop and the two `UserButton` placements in
  `components/staff-shell.tsx`; `components/brand.tsx` survives as the header
  content.

### `app/(shell)/layout.tsx`

- Purpose: `<SidebarProvider><AppSidebar /><SidebarInset><header
  className="flex h-14 shrink-0 items-center gap-2 border-b px-4"><SidebarTrigger
  /><Separator orientation="vertical" className="mr-1 h-4" /><span
  className="text-sm text-muted-foreground">Staff console</span></header><div
  className="flex flex-1 flex-col gap-6 p-8">{children}</div></SidebarInset></SidebarProvider>`.
  That is the whole file. Default export `ShellLayout`, typed with Next 16's
  global `LayoutProps<"/">`.
- Files: `@/components/app-sidebar`, `@/components/ui/separator`,
  `@/components/ui/sidebar`.
- Roofing bits: the string `Staff console`. Keep or rename.
- Supersedes: `components/staff-shell.tsx` as a whole, and the per-page
  `<StaffShell>` wrapping in `app/page.tsx`, `app/customers/page.tsx`,
  `app/documents/[id]/page.tsx`. In FRSG the route group does the wrapping, so
  pages render only their content. Two things `staff-shell.tsx` does that the
  FRSG layout does not, and which have to land somewhere:
  1. Auth. Expand's `proxy.ts` is a bare `clerkMiddleware()` and every page
     calls `await auth.protect()`. FRSG's `proxy.ts` calls `auth.protect()`
     inside the middleware for every non-public path (`lib/public-routes.ts`),
     so pages never do. Either keep Expand's per-page `auth.protect()` or copy
     FRSG's middleware shape with Expand's public list (`/sign-in`, `/sign-up`,
     `/sign/[token]`).
  2. The owner gate. `staff-shell.tsx` queries `api.documents.access` and
     renders the "Owner access only" screen with `LockKeyhole` when
     `access.owner` is false. FRSG has no equivalent (Convex functions refuse
     instead). Keep this block; it moves into the new layout or a client
     component inside it.
- Route move: Expand's `app/page.tsx`, `app/customers/page.tsx`,
  `app/documents/[id]/page.tsx` move under `app/(shell)/`; `app/sign/[token]`,
  `app/sign-in`, `app/sign-up` stay outside it, exactly as FRSG keeps
  `app/report`, `app/sign`, `app/sign-in` outside.

### `hooks/use-mobile.ts`

- Purpose: `useIsMobile()` via `useSyncExternalStore` on
  `matchMedia("(max-width: 767px)")`, `MOBILE_BREAKPOINT = 768`, server
  snapshot `false`. Stock shadcn `use-mobile` registry hook. 18 lines, no deps.
- Supersedes: nothing; Expand has no `hooks/` directory. Create it (the
  `components.json` `hooks` alias already points at `@/hooks`).

## Kit

### `components/page-header.tsx`

- `PageHeader({ title: string; description: ReactNode })` renders
  `<header className="space-y-1"><h1 className="text-2xl font-semibold
  tracking-tight">…</h1><p className="text-sm text-muted-foreground">…</p></header>`.
  16 lines, imports only `react`. Used by every index page under `(shell)`.
- Supersedes: the inline `<header className="mb-8 …">` block in
  `components/dashboard.tsx` lines 111–140 (the "Workspace / Documents"
  breadcrumb line goes; FRSG has none). Note the page-level primary action
  (`Upload PDF` / `Add customer`) sits beside the header in Expand but
  `PageHeader` has no action slot; FRSG puts actions in the content below
  (`sites-index.tsx` puts the search `Input` first).

### `components/side-panel.tsx` + `lib/side-panel.ts`

- `lib/side-panel.ts` (pure, 33 lines, no imports): `openPanelId(search,
  param): string | null` and `panelHref(pathname, search, param, openId):
  string`. Tested by `lib/side-panel.test.ts` (vitest, 8 cases). Copy both.
- `components/side-panel.tsx` (`"use client"`):
  - `useSidePanel(param)` returns `{ openId, open(id), close() }`; writes the
    URL with `window.history.pushState` (not the router) so the list behind
    the panel is not re-fetched, and reads it back through `useSearchParams`.
  - `SidePanel({ title, description?, onClose, children })` is a `Sheet`
    rendered `open` with `SheetContent className="data-[side=right]:sm:max-w-3xl"`;
    `onOpenChange(false)` blurs `document.activeElement` before `onClose()` so
    a field mid-edit commits.
  - `FieldLabel({ htmlFor, children })` and `FieldHeading({ children })`,
    both `text-xs font-medium tracking-wide text-slate-500 uppercase`.
- Packages: `next/navigation`, `react`. Files: `@/components/ui/sheet`,
  `@/lib/side-panel`.
- Roofing bits: none in code; the comments name Solutions/Proposals issues.
- Supersedes: the `Dialog`-based add-customer/upload modal in
  `components/dashboard.tsx` lines 337–483 is the closest thing, but it is a
  modal, not a list-plus-panel. Nothing in Expand is superseded outright; this
  is new surface for the Proposals/Solutions tabs. `FieldLabel` overlaps
  Expand's `components/ui/label.tsx` (`Label`), which stays for forms.
- Gotcha: `useSearchParams` in a client component under a statically
  rendered route needs a `Suspense` boundary in Next 16; FRSG avoids it with
  `export const dynamic = "force-dynamic"` in `app/layout.tsx`.

### `components/index-row.tsx`

- `IndexRow({ href, title, subtitle: ReactNode, hint: ReactNode })`: an
  `<li><Link className="flex items-center gap-4 px-4 py-3 … hover:bg-slate-50">`
  with truncated title/subtitle, the hint hidden below `sm`, and a
  `ChevronRight`. `IndexEmptyState({ icon: LucideIcon, title, children })`:
  `grid min-h-64 place-items-center rounded-2xl border border-dashed bg-slate-50`.
- Packages: `lucide-react`, `next/link`, `react`. No file deps.
- The container is the caller's, always
  `<ul className="divide-y overflow-hidden rounded-2xl border bg-white">`
  (`sites-index.tsx` line 55, `customers-index.tsx` line 66) with a loading
  state `<div className="grid min-h-64 place-items-center rounded-2xl border
  bg-white"><LoaderCircle className="size-6 animate-spin text-slate-500" /></div>`.
  That trio (search Input, rounded-2xl list, IndexRow) is the FRSG index page.
- Roofing bits: none.
- Supersedes: both `Table`-based lists in `components/dashboard.tsx` (the
  customers table lines 204–262, the documents table lines 264–335) and its
  private `Empty` component (lines 487–514). Once ported, `components/ui/table.tsx`
  has no remaining consumer (`table` is imported only by `dashboard.tsx`) and
  can go, as can the three stat tiles (lines 142–167): FRSG's dashboard has no
  stat tiles.
- Note on colour: `IndexRow` hard-codes `slate-*` (`text-slate-900`,
  `text-slate-500`, `hover:bg-slate-50`) rather than theme tokens. Verbatim
  means slate. Expand's `--foreground: #2e3337` override will then differ from
  row text; see globals.css below.

### `components/proposal-chips.tsx`

- `ProposalStateChip({ state: ProposalState })`: returns `null` for
  `"draft"`, otherwise `<span className="shrink-0 rounded-full border px-2
  py-0.5 text-xs font-medium">` coloured `sky` (sent), `emerald` (approved),
  `slate` (declined), label from `proposalStateLabel`.
- Files: `@/lib/proposals` (`ProposalState = "draft" | "sent" | "approved" |
  "declined"`, `proposalStateLabel`), `@/lib/utils`.
- Roofing bits: `lib/proposals.ts` itself pulls `@shared/proposal-pricing`,
  `@shared/proposal-standing`, `@shared/proposal-signing`, `@shared/money`.
  Do not port that file for the chip; lift the `ProposalState` type and the
  four-line `proposalStateLabel` switch into Expand's own proposals module
  when it exists.
- Supersedes: `Status` in `components/dashboard.tsx` lines 49–74, which uses
  `Badge variant="secondary"` with emerald/blue/amber and the document
  vocabulary `draft, ready, viewed, signed, declined`. Documents keep their
  chip (different states); Proposals get this one. If Documents are re-skinned
  to match, the chip pattern is the same span with different colour cases.
  `components/ui/badge.tsx` then has `Status` as its only consumer.

### `components/ui/segmented.tsx`

- `Segmented<T extends string>({ label, value, onChange, options })`: a
  `role="radiogroup"` of `role="radio"` buttons, `inline-flex rounded-lg border
  bg-white p-0.5 text-sm`, selected = `bg-slate-900 text-white`. `"use client"`,
  imports only `@/lib/utils`. Not a shadcn item despite living in `ui/`.
- Supersedes: the status filter row in `components/dashboard.tsx` lines
  184–201 (six `Button size="sm" variant={secondary|ghost}`). Same job, one
  control.

### `components/sidebar-card.tsx` (+ `components/monogram.tsx`)

- Purpose: the on-call card at the foot of the sidebar: monogram with a status
  ring, name, one status line, an `ArrivalPill` for an owed LeakStop Order,
  and a `Popover` holding Sign out, Clerk's account door, this week's shifts
  and the take/confirm/drop action. Export `SidebarCard`. 312 lines.
- Packages: `@clerk/nextjs` (`useClerk`), `convex/react`, `convex/server`
  (`FunctionReturnType`), `lucide-react`, `next/link`, `react`.
- Files: `@convex/api` (`onCallCard.card`, `onCallShifts.take/confirm/drop`),
  `@shared/on-call-card`, `@shared/on-call-shifts`, `@/components/monogram`,
  `@/components/ui/button`, `@/components/ui/popover`,
  `@/components/ui/sidebar` (`useSidebar`), `@/components/ui/skeleton`,
  `@/hooks/use-now`, `@/lib/refusal`, `@/lib/utils`.
- Roofing bits: nearly all of it. On-call shifts, the rota, LeakStop arrival
  pill, `refusalMessage`, `useNow`. Map #8 puts on-call and staff roles out of
  scope.
- Verdict: do not port. Keep the 30-line shape only: `Popover` above a
  `Monogram` + name row, with Sign out and "Edit name, email or phone"
  (`clerk.openUserProfile()`), and the `openAccount()` detail that closes the
  mobile sheet (`setOpenMobile(false)`) before Clerk's modal opens.
  `monogram.tsx` (40 lines, `Monogram({ name, size, className })`, initials
  in `bg-slate-900`) is harmless to copy for that row. Alternatively keep
  Clerk's `UserButton` in `SidebarFooter` and skip both files and `popover`.
- Supersedes: the footer block in `components/staff-shell.tsx` lines 52–58
  (`UserButton` + "Staff workspace / Expand Handyman").

### `components/copy-link.tsx`

- `CopyLinkButton({ url, label = "Copy link" })`: `Button variant="outline"
  size="sm"` with `Copy`/`Check` icon (`data-icon="inline-start"`), a
  `role="status" aria-live="polite"` span saying "Copied" or "Copy unavailable —
  select the link and copy it by hand.", resetting after 4 s. Callers render
  the URL as selectable text beside it.
- Packages: `lucide-react`, `react`. Files: `@/components/ui/button`.
- Roofing bits: none.
- Supersedes: whatever copy-link control `components/document-editor.tsx`
  draws for the signing link (it builds the URL itself; the button behaviour
  is what this replaces). Callers in FRSG compute the origin with
  `hooks/use-app-origin.ts` (`useAppOrigin()`, `useSyncExternalStore` on
  `window.location.origin`, `""` on the server); copy that 20-line hook too.

## Primitives (`components/ui/*`)

All are stock base-nova shadcn on `@base-ui/react`. FRSG's copies use no
semicolons (registry style); Expand's use semicolons (Prettier). `diff -w`
between the three files both repos have shows only that.

| FRSG file | Exports | Base UI import | Used by (kit) | In Expand? |
|---|---|---|---|---|
| `ui/button.tsx` | `Button, buttonVariants` | `@base-ui/react/button` | everything | yes, identical |
| `ui/input.tsx` | `Input` | `@base-ui/react/input` | sidebar, index search | yes, identical |
| `ui/separator.tsx` | `Separator` | `@base-ui/react/separator` | shell header, sidebar | yes, identical |
| `ui/sheet.tsx` | `Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription` | `@base-ui/react/dialog` | sidebar (mobile), SidePanel | no: add |
| `ui/tooltip.tsx` | `Tooltip, TooltipTrigger, TooltipContent, TooltipProvider` | `@base-ui/react/tooltip` | sidebar (collapsed labels) | no: add |
| `ui/skeleton.tsx` | `Skeleton` | none | sidebar, SidebarCard | no: add |
| `ui/popover.tsx` | `Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger` | `@base-ui/react/popover` | SidebarCard (and `deal-activities`) | no: add only if the footer popover is kept |
| `ui/calendar.tsx` | `Calendar, CalendarDayButton` | `react-day-picker` | `deal-activities.tsx` only | no: do not add |
| `ui/segmented.tsx` | `Segmented` | none | deals board, agenda | no: add (see above) |

`SheetContent` defaults to `side="right"` and `sm:max-w-sm`; `SidePanel`
widens it to `sm:max-w-3xl`. `SheetTitle` uses `font-heading`, which
`globals.css` maps to `--font-sans`. `tooltip.tsx` and `popover.tsx` use
`animate-in`/`slide-in-from-*` from `tw-animate-css` (already imported in
Expand's `globals.css`).

Expand primitives with no FRSG counterpart in the kit: `alert-dialog`,
`badge`, `card`, `checkbox`, `dialog`, `field`, `label`, `table`. They are
used by `document-editor.tsx`, `signing-page.tsx`, `customer-fields.tsx` and
`dashboard.tsx`; none conflict with the port. `table` loses its only consumer
if `dashboard.tsx` is rebuilt on `IndexRow`; `card` keeps `document-editor.tsx`.

## `components.json`

Identical in every field Expand has: `style: "base-nova"`, `rsc`, `tsx`,
`tailwind.css: app/globals.css`, `baseColor: neutral`, `cssVariables: true`,
`iconLibrary: lucide`, same five aliases. FRSG adds `tailwind.prefix: ""`,
`rtl: false`, `menuColor: "default"`, `menuAccent: "subtle"`, `registries: {}`,
all defaults. No change needed; `npx shadcn add sheet tooltip skeleton popover
sidebar` in Expand generates the same files FRSG has (bar the `cn` import path
and semicolons).

## `app/globals.css` tokens

FRSG lines 1–130 and Expand lines 1–131 are the same generated shadcn neutral
theme: identical `@theme inline` block, identical `:root` and `.dark` oklch
values, identical `@layer base`. Differences:

- Fonts. FRSG: `--font-sans: var(--font-sans)` (filled by `next/font`'s Geist
  variable) and `--font-mono: var(--font-geist-mono)`. Expand:
  `--font-sans: "Inter", "Segoe UI", sans-serif` but **nothing loads Inter**
  (`grep next/font app components` is empty), so today the shell renders in
  whatever local Inter or Segoe UI the machine has. Expand also declares
  `--font-mono: var(--font-geist-mono)` with no `Geist_Mono` loaded.
- Expand adds a second `:root` (lines 132–139) overriding `--primary: #e29b0c`,
  `--primary-foreground: #24292d`, `--foreground: #2e3337`, `--sidebar:
  #fafaf9`, `--accent: #f0eeea`, `--ring: #c18718`. This is the brand: keep.
  Verbatim FRSG components mix tokens with hard-coded `slate-*` and
  `bg-white`, so the amber primary shows on buttons and focus rings while
  rows and chips stay slate. Accept or override `IndexRow`'s classes; the
  map says only brand name, logo, nav and wording change.
- Expand adds `@import "./paper-screen.css"`, the Allura `@font-face`,
  `.signature-ink`, the Homemade Apple `@font-face` and a tap-highlight reset
  (lines 140–158). All Expand's own; keep.
- FRSG lines 131–279 are roof-report CSS: `html:has(.roof-report-screen)`
  background, `.roof-map-label`, `.roof-report-building-label`,
  `.roof-report-section-label`, `.roof-report-marker-number`, the
  `roof-report-marker-rock` keyframes and the `.roof-report-card` dark-glass
  aliases. Strip all of it.
- FRSG has no `@font-face` in `globals.css`; the paper faces live in
  `app/report/fonts.css`, imported by the report/sign layouts only.

Net: Expand's `globals.css` needs no token changes for the shell. The only
edit is the `--font-sans` line if Geist is adopted.

## Fonts

- Geist and Geist Mono: `app/layout.tsx` lines 2, 14–22: `Geist({ variable:
  "--font-sans", subsets: ["latin"] })`, `Geist_Mono({ variable:
  "--font-geist-mono", … })` from `next/font/google`, both variables on
  `<html className="… h-full antialiased">`, body `min-h-full flex flex-col`.
  Port: add the two calls to Expand's `app/layout.tsx` and set `--font-sans:
  var(--font-sans)` in `globals.css`. No package (bundled by `next/font`).
- Tinos (4 weights) and Homemade Apple: `app/report/fonts.css` `@font-face`
  rules, `font-display: block`, served from `public/fonts/` (files listed in
  `docs/paper-fonts.md`). Stacks in `lib/paper-fonts.ts`: `paperSerifStack =
  'Tinos, "Times New Roman", Times, serif'`, `paperScriptStack = '"Homemade
  Apple", Tinos, cursive'`, and `loadPaperFonts()` which awaits
  `document.fonts.load` for every face (3 s timeout) before `window.print()`.
  These belong to the proposal paper ticket, not the shell. Expand already
  has `public/fonts/HomemadeApple-Regular.woff2` (+ `.ttf`, licence) and the
  `@font-face` in `globals.css`; it lacks the four Tinos files and
  `paper-fonts.ts`. Expand's `lib/handwriting-font.ts` and
  `lib/signature-font.ts` are base64 font blobs for pdf-lib, unrelated.
- FRSG's report layout uses `Inter` via `next/font/google` for the customer
  report chrome; the sign layout uses none (paper-screen.css sets
  `ui-sans-serif, system-ui`). Not shell.
- Allura (`public/fonts/Allura-Regular.ttf`, `@font-face` in Expand's
  `globals.css`) has no FRSG counterpart; it is Expand's.

## Packages

FRSG `apps/web/package.json` vs Expand `package.json`:

| Package | FRSG | Expand | Needed for the shell/kit? |
|---|---|---|---|
| `@base-ui/react` | ^1.7.0 | ^1.7.0 (installed 1.8.0) | yes, present |
| `class-variance-authority` | ^0.7.1 | ^0.7.1 | yes, present |
| `clsx`, `tailwind-merge` | yes | yes | yes, present |
| `lucide-react` | ^1.33.0 | ^1.33.0 | yes, present |
| `shadcn` | ^4.19.0 | ^4.19.0 (installed 4.21.0) | yes (for `shadcn/tailwind.css`), present |
| `tw-animate-css` | ^1.4.0 | ^1.4.0 | yes, present |
| `next` | 16.3.2 | 16.3.4 | present |
| `@clerk/nextjs`, `convex` | ^7.8.0 / ^1.39.1 | same | present |
| `react-day-picker` | ^10.0.1 | no | **no**: only `ui/calendar.tsx`, only used by `deal-activities.tsx` (Deals out of scope) |
| `ionicons` | ^8.1.0 | no | **no**: roof-report glyphs only (`roof-report/report-glyphs.tsx`, `walk-step.tsx`, `roof-report-map.tsx`) |
| `posthog-js` | ^1.433.2 | no | **no**: session replay (`lib/session-replay.ts`, `hooks/use-customer-view.ts`), out of scope |
| `@vis.gl/react-google-maps` | ^1.9.0 | no | **no**: maps |
| `cn` | no | ^0.2.6 | Expand-only; the registry's `cn` package. Unused by any Expand file (`grep 'from "cn"'` is empty); removable |
| `eslint`, `eslint-config-next` | yes | no | optional; Expand has no lint script |

Nothing to install. FRSG's `tsconfig.json` adds `@convex/*` and `@shared/*`
path aliases for its monorepo; Expand imports `@/convex/_generated/api`
directly, so every ported `@convex/api` import becomes
`@/convex/_generated/api` and `@shared/*` imports are dropped with the code
that used them.

## Supersession map (Expand file by file)

| Expand file | Fate |
|---|---|
| `components/staff-shell.tsx` | Deleted. Replaced by `app/(shell)/layout.tsx` + `components/app-sidebar.tsx` + `components/ui/sidebar.tsx`. Its owner gate (`api.documents.access`, `LockKeyhole` screen) moves into the new layout. |
| `components/brand.tsx` | Kept. Becomes the `SidebarHeader` content in `app-sidebar.tsx` and stays on the sign-in/sign-up pages. |
| `components/dashboard.tsx` | Rebuilt: `PageHeader` for the header, `Input` + `<ul className="divide-y overflow-hidden rounded-2xl border bg-white">` + `IndexRow` for both lists, `IndexEmptyState` for `Empty`, `Segmented` for the status filter. The add-customer/upload `Dialog` can stay a Dialog or become a `SidePanel`. `Status` chip stays for Documents. |
| `app/globals.css` | Kept. Optional: switch `--font-sans` to Geist's variable. Nothing from FRSG's roof-report tail comes over. |
| `app/layout.tsx` | Add `Geist`/`Geist_Mono` from `next/font/google` and their variables on `<html>`. Consider FRSG's `export const dynamic = "force-dynamic"` for the `useSearchParams` in `SidePanel`. |
| `app/page.tsx`, `app/customers/page.tsx`, `app/documents/[id]/page.tsx` | Move under `app/(shell)/`, drop the `<StaffShell>` wrapper. |
| `components/ui/button.tsx`, `input.tsx`, `separator.tsx` | Unchanged (identical to FRSG). |
| `components/ui/table.tsx` | Orphaned once `dashboard.tsx` is rebuilt; delete. |
| `components/ui/card.tsx` | Kept for `document-editor.tsx`. |
| `components/ui/badge.tsx` | Kept for the Documents `Status` chip. |
| new `components/ui/sheet.tsx`, `tooltip.tsx`, `skeleton.tsx`, `sidebar.tsx`, `segmented.tsx`, (`popover.tsx`) | Copied verbatim. |
| new `hooks/use-mobile.ts`, `hooks/use-app-origin.ts` | Copied verbatim. |
| new `components/page-header.tsx`, `side-panel.tsx`, `index-row.tsx`, `copy-link.tsx`, (`monogram.tsx`) | Copied verbatim. |
| new `lib/side-panel.ts` + `lib/side-panel.test.ts` | Copied verbatim; the test runs under Expand's existing vitest. |
| `components/proposal-chips.tsx` | Copied with `ProposalState`/`proposalStateLabel` inlined or pointed at Expand's future `lib/proposals.ts`. |

## Surprises

1. Expand's `globals.css` names Inter as `--font-sans` but no file loads it;
   the current shell is on system fonts. Adopting Geist is therefore not a
   swap but the first real webfont.
2. The three shadcn primitives both repos have are byte-identical modulo
   semicolons, so the "port" of the primitive layer is `npx shadcn add sheet
   tooltip skeleton sidebar` (plus fixing the `cn` import) rather than copying.
3. FRSG's kit is not token-pure: `IndexRow`, `Segmented`, `Monogram`,
   `FieldLabel` and the list containers hard-code `slate-*` and `bg-white`.
   Expand's amber `--primary` and charcoal `--foreground` overrides will sit
   beside slate rows unless the brand is also expressed in those classes.
4. `SidebarCard` is 312 lines of on-call rota; the reusable part is one
   popover with Sign out and the Clerk account door. FRSG deliberately removed
   the header `UserButton` (comment at `app-sidebar.tsx` lines 102–104).
5. Auth placement differs: FRSG protects in `proxy.ts` and pages are bare;
   Expand protects per page. Moving pages under `(shell)` does not by itself
   protect them.
6. `react-day-picker`'s only consumer is the Deals activity calendar, so the
   ticket's suspicion is right: it is unnecessary here.
