import { LogOut, User, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/client/auth";

interface UserMenuProps {
  onInvite?(): void;
}

export const UserMenu = ({ onInvite }: UserMenuProps) => {
  const { user, isAuthenticated, isInitializing, signOut } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  if (!isAuthenticated || !user) {
    if (["/", "/app/login", "/app/invite/accept"].includes(location.pathname)) return null;

    return (
      <div className="flex items-center gap-3">
        {isInitializing ? <span className="hidden text-xs text-zinc-500 sm:block">Checking session...</span> : null}
        <Link
          to="/app/login"
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-700/60 bg-zinc-800/60 px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700/60 hover:text-zinc-100"
        >
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-xl border border-zinc-800/60 bg-zinc-900/70 px-3 py-1.5 text-sm transition-colors hover:border-zinc-700/60 hover:bg-zinc-800/60"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={user.displayName}
        onClick={() => setOpen((prev) => !prev)}
      >
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-500/15 text-accent-400">
          <User className="h-3.5 w-3.5" />
        </div>
        <span className="hidden text-zinc-200 sm:block">{user.displayName}</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 animate-scale-fade origin-top-right rounded-xl border border-zinc-800/60 bg-zinc-900 p-1.5 shadow-lg shadow-black/40"
        >
          <div className="border-b border-zinc-800/60 px-3 py-2.5">
            <p className="text-sm font-medium text-zinc-200">{user.displayName}</p>
            <p className="text-xs text-zinc-500">@{user.slug}</p>
          </div>

          <div className="mt-1.5 space-y-0.5">
            <Link
              to="/app/me"
              role="menuitem"
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100"
              onClick={() => setOpen(false)}
            >
              <User className="h-4 w-4 text-zinc-500" />
              Profile & Settings
            </Link>
            {onInvite ? (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100"
                onClick={() => {
                  setOpen(false);
                  onInvite();
                }}
              >
                <UserPlus className="h-4 w-4 text-zinc-500" />
                Invite User
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
            >
              <LogOut className="h-4 w-4 text-zinc-500" />
              Sign Out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
