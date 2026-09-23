// PROTOTYPE (issue #68): throwaway. Prints the invoice paper prototype to PDF
// with headless Chrome, the way scripts/print-proposal-paper.tsx prints the
// proposal paper, one file per variant.
//
//   npx tsx scripts/print-invoice-paper.tsx [out-dir]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { Variants, invoiceFor } from "../components/prototype-invoice-paper/fixtures";
import { InvoicePaper } from "../components/prototype-invoice-paper/invoice-paper";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(process.argv[2] ?? join(root, "docs", "prototypes", "invoice-paper"));
const publicUrl = pathToFileURL(join(root, "public")).href;

function stylesheets(): string {
  const read = (name: string) => readFileSync(join(root, "app", name), "utf8");
  return [
    read("paper-fonts.css"),
    read("paper-screen.css"),
    read("paper-print.css"),
    read("proposal-paper.css").replace(/@import "\.\/paper-fonts\.css";/, ""),
    read("prototype/invoice-paper/prototype.css"),
  ]
    .join("\n")
    .replaceAll('url("/fonts/', `url("${publicUrl}/fonts/`);
}

function page(variant: string): string {
  const body = renderToStaticMarkup(
    <div className="paper-screen">
      <div className="paper-sheets">
        <InvoicePaper invoice={invoiceFor(variant)} />
      </div>
    </div>,
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
const work = mkdtempSync(join(tmpdir(), "invoice-paper-"));
for (const { key } of Variants) {
  const html = join(work, `${key}.html`);
  const pdf = join(outDir, `${key}.pdf`);
  writeFileSync(html, page(key));
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
