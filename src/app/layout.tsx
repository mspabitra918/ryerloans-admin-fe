import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";

import "./globals.css";

/**
 * §8.1: the portal is noindex/nofollow. This is belt and braces alongside the
 * X-Robots-Tag header in next.config.ts and public/robots.txt.
 */
export const metadata: Metadata = {
  title: "Ryer Loans Admin",
  description: "Internal loan operations portal.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
