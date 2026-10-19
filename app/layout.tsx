import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./live.css";
import { Analytics } from "@vercel/analytics/next";
import { SITE_URL } from "@/lib/site";
import ErrorReporter from "@/components/ErrorReporter";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "pump tower",
  description: "Your Solana bags become a pixel skyscraper. Every token is a floor. Hold longer, live higher.",
  openGraph: {
    title: "pump tower",
    description: "Every token is a floor. Bare walls on day zero, the penthouse at thirty days.",
    images: ["/og.png"],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = { themeColor: "#08090b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div className="fx-scan" aria-hidden />
        <div className="fx-vignette" aria-hidden />
        {children}
        <ErrorReporter />
        <Analytics />
      </body>
    </html>
  );
}
