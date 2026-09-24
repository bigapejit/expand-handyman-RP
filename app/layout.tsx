import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "./providers";
import "./globals.css";

// Every page reads live Clerk and Convex data, so nothing is prerendered, and
// the SidePanel's useSearchParams needs no per-route Suspense boundary.
export const dynamic = "force-dynamic";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Expand Handyman · Staff",
  description: "Proposals, invoices and customer signatures for Expand Handyman.",
  icons: { icon: "/logo.svg", apple: "/icons/apple-touch-icon.png" },
  robots: { index: false, follow: false },
  // Android reads app/manifest.ts; iOS reads these when the site is added to
  // the home screen.
  appleWebApp: { capable: true, title: "Expand", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
