"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { FileText, Menu, X, ArrowUpRight } from "lucide-react";

export const links = [
  { href: "/edit", label: "Edit PDF" },
  { href: "/merge", label: "Merge PDF" },
  { href: "/word-to-pdf", label: "Word to PDF" },
  { href: "/pdf-to-word", label: "PDF to Word" },
  { href: "/sign", label: "Sign PDF" },
];

export function Navigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="nav-inner">
        <Link href="/" className="brand" aria-label="SimplePDF home" onClick={() => setOpen(false)}>
          <span className="brand-icon">
            <FileText size={22} />
          </span>
          Simple<span className="font-normal">PDF</span>
          <span className="brand-dot">.</span>
        </Link>
        <nav aria-label="Main navigation" className="desktop-nav">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <Link className="nav-cta" href="/edit">
          Let’s get started <ArrowUpRight size={15} />
        </Link>
        <button
          className="mobile-toggle icon-btn"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile navigation">
          <Link href="/" onClick={() => setOpen(false)}>
            Home
          </Link>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
