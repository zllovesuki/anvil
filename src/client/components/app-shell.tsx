import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { AppConfigErrorPage } from "@/client/components/app-config-error-page";
import { ErrorBoundary } from "@/client/components/error-boundary";
import { Header } from "@/client/components/header";
import { Footer } from "@/client/components/footer";
import { InviteDialog } from "@/client/components/invite-dialog";
import { useRouteAnnouncer } from "@/client/hooks/use-route-announcer";

export const AppShell = () => {
  const [inviteOpen, setInviteOpen] = useState(false);
  const { pathname } = useLocation();
  const { startupError } = useAuth();
  const isLandingRoute = pathname === "/";
  const announcerRef = useRouteAnnouncer();

  return (
    <div className="relative z-10 min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:rounded-lg focus:bg-zinc-900 focus:px-4 focus:py-2 focus:text-accent-400 focus:ring-2 focus:ring-accent-500/50"
      >
        Skip to content
      </a>
      <Header variant={isLandingRoute ? "public" : "app"} onInvite={() => setInviteOpen(true)} />
      <main id="main-content" className={isLandingRoute ? "overflow-x-clip" : undefined}>
        <div className={isLandingRoute ? undefined : "mx-auto max-w-7xl px-4 py-6 sm:px-6"}>
          <ErrorBoundary>
            {startupError ? <AppConfigErrorPage message={startupError.message} /> : <Outlet />}
          </ErrorBoundary>
        </div>
      </main>
      <Footer />
      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <div ref={announcerRef} className="sr-only" aria-live="polite" />
    </div>
  );
};
