import { createClerkClient } from "@clerk/backend";
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const templates = await clerk.jwtTemplates.list();
const claims = {
  aud: "convex",
  email: "{{user.primary_email_address}}",
  email_verified: "{{user.email_verified}}",
  name: "{{user.full_name}}",
};
const existing = templates.data.find((t) => t.name === "convex");
if (existing)
  await clerk.jwtTemplates.update({
    templateId: existing.id,
    name: "convex",
    claims,
  });
else await clerk.jwtTemplates.create({ name: "convex", claims });
const identifiers =
  await clerk.allowlistIdentifiers.getAllowlistIdentifierList();
for (const identifier of ["andrew@cogtex.ai", "*@expandhandyman.com"]) {
  if (!identifiers.data.some((i) => i.identifier === identifier))
    await clerk.allowlistIdentifiers.createAllowlistIdentifier({
      identifier,
      notify: false,
    });
}
await clerk.instance.updateRestrictions({ allowlist: true });
console.log("Convex JWT template configured; signup allows the owner and expandhandyman.com.");
