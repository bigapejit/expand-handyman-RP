function convexSite() {
  return process.env.NEXT_PUBLIC_CONVEX_URL!.replace(
    ".convex.cloud",
    ".convex.site",
  );
}
export async function getPdf(
  id: string,
  options: { token?: string; jwt?: string | null; signed?: boolean } = {},
) {
  const url = new URL("/file", convexSite());
  url.searchParams.set("id", id);
  if (options.token) url.searchParams.set("token", options.token);
  if (options.signed) url.searchParams.set("signed", "1");
  const res = await fetch(url, {
    headers: options.jwt ? { Authorization: `Bearer ${options.jwt}` } : {},
    cache: "no-store",
  });
  if (!res.ok)
    throw new Error(
      "The PDF could not be loaded. Check your connection or ask for a new link.",
    );
  return new Uint8Array(await res.arrayBuffer());
}
export function sendSeenBeacon(viewId: string, token: string, kind?: "proposal") {
  const url = new URL("/seen", convexSite()).toString();
  const body = JSON.stringify(kind ? { viewId, token, kind } : { viewId, token });
  // A plain string keeps sendBeacon a CORS simple request, so there is no preflight.
  if (typeof navigator.sendBeacon === "function")
    navigator.sendBeacon(url, body);
  else
    void fetch(url, { method: "POST", body, keepalive: true }).catch(() => {});
}
export function downloadPdf(bytes: Uint8Array, title: string) {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 100) || "Document"}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
// Storage keeps the content type the upload names, which is how a saved file
// is known for a PDF or a photo's JPEG afterwards.
export async function uploadFile(url: string, data: Blob, contentType: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: data,
  });
  if (!res.ok) throw new Error("Upload failed. Please try again.");
  return (await res.json()).storageId as string;
}
