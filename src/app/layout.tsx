import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "@/components/navigation";
import "@fontsource-variable/inter";
import "@fontsource/caveat/400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SimplePDF — PDF editing without the headache", template: "%s | SimplePDF" },
  description:
    "Simple PDF tools for everyday documents. Edit, merge, convert and sign PDFs without complicated software.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <Navigation />
        <main id="main-content">{children}</main>
        <footer className="site-footer">
          <Link href="/" className="font-semibold">
            SimplePDF.
          </Link>
          <span>A little less paperwork. A little more done.</span>
          <span>No accounts. No subscriptions.</span>
          <span>© 2026 SimplePDF. Built by Sabut B K.</span>
        </footer>
      </body>
    </html>
  );
}
