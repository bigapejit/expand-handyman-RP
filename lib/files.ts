export async function getPdf(
  id: string,
  options: { token?: string; jwt?: string | null; signed?: boolean } = {},
) {
  const base = process.env.NEXT_PUBLIC_CONVEX_URL!.replace(
    ".convex.cloud",
    ".convex.site",
  );
  const url = new URL("/file", base);
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
export async function uploadFile(url: string, data: Blob) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: data,
  });
  if (!res.ok) throw new Error("Upload failed. Please try again.");
  return (await res.json()).storageId as string;
}
