import type { MetadataRoute } from "next";

// What Android's "Add to Home screen" reads. Installing the site gives the
// owner the staff console as an app: our icon on the launcher, opened
// full-screen without the browser's address bar, and every Vercel deploy is
// on the phone the next time it opens. No separate mobile build.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Expand Handyman Staff",
    short_name: "Expand",
    description:
      "Proposals, invoices and customer signatures for Expand Handyman.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
