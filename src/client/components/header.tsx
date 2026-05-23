import { FolderPlus, Hammer, Menu, Workflow, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "@/client/auth";

import { UserMenu } from "@/client/components/user-menu";

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  [
    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
    isActive ? "bg-accent-500/10 text-accent-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
  ].join(" ");

interface HeaderProps {
  variant?: "app" | "public";
}

const HeaderBrand = ({ href, subtitle }: { href: string; subtitle: string }) => (
  <Link to={href} className="group flex items-center gap-3 transition-opacity hover:opacity-80">
    <span className="inline-grid h-9 w-9 place-items-center">
      <Hammer
        className="h-6 w-6 text-accent-400 transition-transform duration-200 group-hover:-rotate-6"
        strokeWidth={2}
        aria-hidden="true"
      />
    </span>
    <span className="hidden sm:block">
      <strong className="block font-display text-sm font-semibold text-zinc-100">anvil</strong>
      <small className="block text-xs text-zinc-400">{subtitle}</small>
    </span>
  </Link>
);

const PublicHeaderActions = ({ isAuthenticated }: { isAuthenticated: boolean }) => (
  <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">{isAuthenticated ? <UserMenu /> : null}</div>
);

export const Header = ({ variant = "app" }: HeaderProps) => {
  const { isAuthenticated } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (variant === "public") {
    return (
      <header className="sticky top-0 z-50 w-full border-b border-zinc-800/60 bg-zinc-900/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <HeaderBrand href="/" subtitle="Edge-native CI" />
          <PublicHeaderActions isAuthenticated={isAuthenticated} />
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800/60 bg-zinc-900/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-5">
          <HeaderBrand href={isAuthenticated ? "/app/projects" : "/"} subtitle="Edge-native CI" />

          {isAuthenticated ? (
            <nav aria-label="Main navigation" className="hidden items-center gap-1.5 md:flex">
              <NavLink to="/app/projects" end className={navLinkClass}>
                <Workflow className="h-3.5 w-3.5" />
                Projects
              </NavLink>
              <NavLink to="/app/projects/new" className={navLinkClass}>
                <FolderPlus className="h-3.5 w-3.5" />
                New Project
              </NavLink>
            </nav>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <UserMenu />
          {isAuthenticated ? (
            <button
              type="button"
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav"
              aria-label="Toggle navigation"
              className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 md:hidden"
              onClick={() => setMobileNavOpen((prev) => !prev)}
            >
              {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          ) : null}
        </div>
      </div>

      {mobileNavOpen && isAuthenticated ? (
        <nav id="mobile-nav" aria-label="Mobile navigation" className="border-t border-zinc-800/60 px-4 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            <NavLink to="/app/projects" end className={navLinkClass} onClick={() => setMobileNavOpen(false)}>
              <Workflow className="h-3.5 w-3.5" />
              Projects
            </NavLink>
            <NavLink to="/app/projects/new" className={navLinkClass} onClick={() => setMobileNavOpen(false)}>
              <FolderPlus className="h-3.5 w-3.5" />
              New Project
            </NavLink>
          </div>
        </nav>
      ) : null}
    </header>
  );
};
