import { spawnSync } from "node:child_process";
import { join } from "node:path";
const cli = join(process.env.APPDATA, "npm/node_modules/vercel/dist/index.js");
for (const key of [
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL",
]) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "env",
      "add",
      key,
      "production",
      "--yes",
      "--force",
      ...(key === "CLERK_SECRET_KEY" ? ["--sensitive"] : []),
    ],
    { input: process.env[key], encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0)
    throw new Error(`Could not configure ${key}: ${result.stderr}`);
  console.log(`Configured ${key}`);
}
