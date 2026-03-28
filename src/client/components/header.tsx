import { FolderPlus, Hammer, Menu, Workflow, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { ModeToggle } from "@/client/components/mode-toggle";

import { UserMenu } from "@/client/components/user-menu";
import type { AuthMode } from "../lib";

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  [
    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
    isActive ? "bg-accent-500/10 text-accent-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
  ].join(" ");

interface HeaderProps {
  variant?: "app" | "public";
  onInvite?: () => void;
}

const HeaderBrand = ({ href, subtitle }: { href: string; subtitle: string }) => (
  <Link to={href} className="flex items-center gap-3 transition-opacity hover:opacity-80">
    <span className="inline-grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-accent-500 to-accent-600 shadow-sm shadow-accent-500/10">
      <Hammer className="h-5 w-5 text-white" />
    </span>
    <span className="hidden sm:block">
      <strong className="block font-display text-sm font-semibold text-zinc-100">anvil</strong>
      <small className="block text-xs text-zinc-500">{subtitle}</small>
    </span>
  </Link>
);

const PublicHeaderActions = ({
  isAuthenticated,
  showTransportToggle,
  mode,
  setMode,
  onInvite,
}: {
  isAuthenticated: boolean;
  showTransportToggle: boolean;
  mode: AuthMode;
  setMode: (mode: AuthMode) => void;
  onInvite?: () => void;
}) => (
  <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
    {showTransportToggle ? (
      <div className="flex items-center gap-2">
        <span className="hidden text-[10px] uppercase tracking-[0.24em] text-zinc-600 lg:block">Local transport</span>
        <ModeToggle currentMode={mode} onChange={setMode} />
      </div>
    ) : null}

    {isAuthenticated ? <UserMenu onInvite={onInvite} /> : null}
  </div>
);

export const Header = ({ variant = "app", onInvite }: HeaderProps) => {
  const { canSelectMode, isAuthenticated, mode, setMode } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const showTransportToggle = !isAuthenticated && canSelectMode;

  if (variant === "public") {
    return (
      <header className="sticky top-0 z-50 w-full border-b border-zinc-800/60 bg-zinc-950/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <HeaderBrand href="/" subtitle="Edge-native CI" />
          <PublicHeaderActions
            isAuthenticated={isAuthenticated}
            mode={mode}
            onInvite={onInvite}
            setMode={setMode}
            showTransportToggle={showTransportToggle}
          />
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800/60 bg-zinc-950/95 backdrop-blur-sm">
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
          {showTransportToggle ? <ModeToggle currentMode={mode} onChange={setMode} /> : null}
          <UserMenu onInvite={isAuthenticated ? onInvite : undefined} />
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
