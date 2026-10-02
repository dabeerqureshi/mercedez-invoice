"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/config";

/** Mercedes connection state as reported by /api/mercedes/status. */
export type ConnectionState =
  | "unknown"
  | "connected"
  | "pending"
  | "disconnected"
  | "unconfigured";

interface HeaderProps {
  priceSource: string;
  connection?: ConnectionState;
  onLogin?: () => void;
  /** Phase 4 auth: shown only when APP_PASSWORD is configured. */
  onLogout?: () => void;
}

const BADGES: Record<
  Exclude<ConnectionState, "unknown">,
  { label: string; className: string }
> = {
  connected: {
    label: "Mercedes connected",
    className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  },
  pending: {
    label: "Login in progress",
    className: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  },
  disconnected: {
    label: "Mercedes not connected",
    className: "border-white/20 bg-white/10 text-header-muted",
  },
  unconfigured: {
    label: "Browserbase not set",
    className: "border-white/20 bg-white/10 text-header-muted",
  },
};

export function Header({
  priceSource,
  connection = "unknown",
  onLogin,
  onLogout,
}: HeaderProps) {
  const badge = connection === "unknown" ? null : BADGES[connection];
  const pathname = usePathname();
  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        pathname === href
          ? "bg-white/15 text-white"
          : "text-header-muted hover:bg-white/10 hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <header className="bg-header">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-6 py-3">
        <div className="flex flex-col">
          <span className="text-[19px] font-bold leading-tight tracking-[0.02em] text-white">
            {APP_NAME}
          </span>
          <span className="text-xs text-header-muted">
            Point-of-Sale · Live Pricing &amp; Invoicing
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <nav className="flex items-center gap-1">
            {navLink("/", "POS")}
            {navLink("/history", "History")}
          </nav>
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-header-muted">
            Price source: {priceSource}
          </span>
          {badge && (
            <span
              className={`rounded-full border px-3 py-1 text-xs font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          )}
          {priceSource === "mercedes" && onLogin && (
            <Button variant="header" size="sm" onClick={onLogin}>
              {connection === "pending"
                ? "Continue Mercedes Login"
                : "Open Mercedes & Login"}
            </Button>
          )}
          {onLogout && (
            <Button variant="header" size="sm" onClick={onLogout}>
              Sign out
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
