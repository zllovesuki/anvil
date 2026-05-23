import { lazy } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { AppShell } from "@/client/components/app-shell";
import { LoadingPanel } from "@/client/components/loading-panel";
import { LandingPage } from "@/client/pages/landing-page";

const CreateProjectPage = lazy(() =>
  import("@/client/pages/create-project-page").then(({ CreateProjectPage }) => ({ default: CreateProjectPage })),
);
const LoginPage = lazy(() => import("@/client/pages/login-page").then(({ LoginPage }) => ({ default: LoginPage })));
const NotFoundPage = lazy(() =>
  import("@/client/pages/not-found-page").then(({ NotFoundPage }) => ({ default: NotFoundPage })),
);
const ProfilePage = lazy(() =>
  import("@/client/pages/profile-page").then(({ ProfilePage }) => ({ default: ProfilePage })),
);
const ProjectDetailPage = lazy(() =>
  import("@/client/pages/project-detail-page").then(({ ProjectDetailPage }) => ({ default: ProjectDetailPage })),
);
const ProjectSettingsPage = lazy(() =>
  import("@/client/pages/project-settings-page").then(({ ProjectSettingsPage }) => ({ default: ProjectSettingsPage })),
);
const ProjectsPage = lazy(() =>
  import("@/client/pages/projects-page").then(({ ProjectsPage }) => ({ default: ProjectsPage })),
);
const RunDetailPage = lazy(() =>
  import("@/client/pages/run-detail-page").then(({ RunDetailPage }) => ({ default: RunDetailPage })),
);

const ProtectedRoute = () => {
  const { isAuthenticated, isInitializing } = useAuth();
  const location = useLocation();

  if (isInitializing) {
    return <LoadingPanel label="Verifying session..." />;
  }

  if (isAuthenticated) {
    return <Outlet />;
  }

  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  return <Navigate to={`/app/login?return_to=${encodeURIComponent(returnTo)}`} replace />;
};

export const App = () => (
  <Routes>
    <Route element={<AppShell />}>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/app/projects" element={<ProjectsPage />} />
        <Route path="/app/projects/new" element={<CreateProjectPage />} />
        <Route path="/app/projects/:projectId/settings" element={<ProjectSettingsPage />} />
        <Route path="/app/projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="/app/runs/:runId" element={<RunDetailPage />} />
        <Route path="/app/me" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes>
);
