import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { AppConfigErrorPage } from "@/client/components/app-config-error-page";
import { ErrorBoundary } from "@/client/components/error-boundary";
import { Header } from "@/client/components/header";
import { Footer } from "@/client/components/footer";
import { InviteDialog } from "@/client/components/invite-dialog";

export const AppShell = () => {
  const [inviteOpen, setInviteOpen] = useState(false);
  const { pathname } = useLocation();
  const { startupError } = useAuth();
  const isLandingRoute = pathname === "/";

  return (
    <div className="relative z-10 min-h-screen">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Header variant={isLandingRoute ? "public" : "app"} onInvite={() => setInviteOpen(true)} />
      <main id="main-content" className={isLandingRoute ? "overflow-x-clip" : undefined}>
        <div className={isLandingRoute ? "animate-slide-up" : "mx-auto max-w-7xl px-4 py-6 sm:px-6"}>
          <ErrorBoundary>
            {startupError ? <AppConfigErrorPage message={startupError.message} /> : <Outlet />}
          </ErrorBoundary>
        </div>
      </main>
      <Footer />
      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
};
