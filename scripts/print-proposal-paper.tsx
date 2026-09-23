// Prints the proposal paper to PDF with headless Chrome, the way the
// prototype's prints were made (docs/prototypes/proposal-paper on
// `prototype/proposal-paper`), so the two can be laid side by side.
//
// The staff paper needs a signed-in owner, which a headless print cannot be,
// so this renders the same screen (components/paper-screen.tsx) to static
// markup with the prototype's dummy proposals, inlines the paper's real
// stylesheets, and prints that.
//
//   npx tsx scripts/print-proposal-paper.tsx [out-dir]
//
// CHROME can name the browser; it defaults to Chrome's usual Windows, macOS
// and Linux paths.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { PaperScreen } from "../components/paper-screen";
import type { PaperProposal, PaperSolution } from "../lib/proposal-paper";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(process.argv[2] ?? join(root, "docs", "prints", "proposal-paper"));

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

const door: PaperSolution = {
  solutionId: "s3",
  title: "Rehang sticking bedroom door",
  lineItems: [
    { name: "Hinge screws, 3 in", quantity: 6, unit: "EA" },
    { name: "Carpentry labor", quantity: 1.5, unit: "HR" },
  ],
  scopeOfWork:
    "Reset the top hinge with 3 in screws into the framing, plane the latch edge where it rubs, and seal the planed edge.",
};

const fan: PaperSolution = {
  solutionId: "s4",
  title: "Replace bathroom exhaust fan cover",
  lineItems: [
    { name: "Exhaust fan grille, universal", quantity: 1, unit: "EA" },
    { name: "Handyman labor", quantity: 1, unit: "HR" },
  ],
  scopeOfWork: "Remove the cracked grille, clean the fan housing and blades, and fit the new grille.",
};

const taxRate = 0.087;

function draft(
  fields: Pick<PaperProposal, "name" | "recommended" | "solutions" | "notes">,
  subtotalCents: number,
): PaperProposal {
  const taxCents = Math.round(subtotalCents * taxRate);
  return {
    proposalId: "preview",
    number: 1,
    code: "3107KAUFFMAN-P1",
    state: "draft",
    sentAt: Date.UTC(2026, 8, 22, 17, 42, 10),
    estimator: { name: "Andrew Putilin", email: "andrew.putilin@example.com" },
    customerName: "Dana Whitfield",
    site: { street: "3107 Kauffman Ave", city: "Vancouver, WA 98660" },
    tax: { source: "lookup", rate: taxRate, locationCode: "0605" },
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
    depositPercent: 50,
    ...fields,
  };
}

const prints: [string, PaperProposal][] = [
  [
    "two-solution-taxed-draft",
    draft(
      {
        name: "Kitchen faucet and hallway repair",
        recommended: true,
        solutions: [faucet, drywall],
        notes:
          "Excludes moving large furniture, any plumbing beyond the under-sink shut-off valves, and repainting ceilings or trim. If rot is found behind the hallway drywall we will stop and price the repair with you before continuing.",
      },
      168_400,
    ),
  ],
  [
    "under-1000-draft",
    draft({ name: "Door and fan fixes", recommended: false, solutions: [door, fan] }, 38_900),
  ],
];

// The paper's stylesheets as the (paper) layout loads them, with the site's
// absolute URLs pointed at the files in `public/`.
function stylesheets(): string {
  const read = (name: string) => readFileSync(join(root, "app", name), "utf8");
  const publicUrl = pathToFileURL(join(root, "public")).href;
  return [
    read("paper-fonts.css"),
    read("paper-screen.css"),
    read("paper-print.css"),
    read("proposal-document.css").replace(/@import "\.\/paper-fonts\.css";/, ""),
  ]
    .join("\n")
    .replaceAll('url("/fonts/', `url("${publicUrl}/fonts/`);
}

function page(paper: PaperProposal): string {
  const publicUrl = pathToFileURL(join(root, "public")).href;
  const body = renderToStaticMarkup(
    <PaperScreen paper={paper} strip={{ tone: "note", body: "Preview of a Draft" }} />,
  ).replaceAll('src="/logo.svg"', `src="${publicUrl}/logo.svg"`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>body{margin:0}${stylesheets()}</style></head><body>${body}</body></html>`;
}

function chrome(): string {
  const candidates = [
    process.env.CHROME,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
  ].filter((path): path is string => Boolean(path));
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error("Chrome not found. Set CHROME to its path.");
  return found;
}

mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "proposal-paper-"));
for (const [name, paper] of prints) {
  const html = join(work, `${name}.html`);
  const pdf = join(outDir, `${name}.pdf`);
  writeFileSync(html, page(paper));
  execFileSync(chrome(), [
    "--headless=new",
    "--disable-gpu",
    `--user-data-dir=${join(work, "profile")}`,
    "--no-pdf-header-footer",
    "--virtual-time-budget=5000",
    `--print-to-pdf=${pdf}`,
    pathToFileURL(html).href,
  ]);
  console.log(pdf);
}
