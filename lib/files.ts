function convexSite() {
  return process.env.NEXT_PUBLIC_CONVEX_URL!.replace(
    ".convex.cloud",
    ".convex.site",
  );
}
// The close beacon of a signing-link view (ADR 0001), to Convex's `/seen`.
export function sendSeenBeacon(viewId: string, token: string) {
  const url = new URL("/seen", convexSite()).toString();
  const body = JSON.stringify({ viewId, token });
  // A plain string keeps sendBeacon a CORS simple request, so there is no preflight.
  if (typeof navigator.sendBeacon === "function")
    navigator.sendBeacon(url, body);
  else
    void fetch(url, { method: "POST", body, keepalive: true }).catch(() => {});
}
// Storage keeps the content type the upload names, which is how a saved file
// is known for a photo's JPEG afterwards.
export async function uploadFile(url: string, data: Blob, contentType: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: data,
  });
  if (!res.ok) throw new Error("Upload failed. Please try again.");
  return (await res.json()).storageId as string;
}
