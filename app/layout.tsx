import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "./providers";
import "./globals.css";
export const metadata: Metadata = {
  title: "Expand Handyman · Staff",
  description: "Documents and customer signatures for Expand Handyman.",
  icons: { icon: "/logo.svg" },
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
