import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <button className={`btn btn-${variant} ${className}`} {...props} />;
}

export function Notice({
  children,
  kind = "info",
}: {
  children: ReactNode;
  kind?: "info" | "error" | "success";
}) {
  const Icon = kind === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function Busy({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <Loader2 className="animate-spin" size={18} aria-hidden="true" />
      {children}
    </span>
  );
}

export function ToolHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="tool-heading">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
