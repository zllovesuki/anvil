import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "@/client/auth";
import { AppShell, LoadingPanel } from "@/client/components";
import {
  AcceptInvitePage,
  CreateProjectPage,
  LandingPage,
  LoginPage,
  NotFoundPage,
  ProfilePage,
  ProjectDetailPage,
  ProjectSettingsPage,
  ProjectsPage,
  RunDetailPage,
} from "@/client/pages";

const ProtectedRoute = () => {
  const { isAuthenticated, isInitializing } = useAuth();

  if (isInitializing) {
    return <LoadingPanel label="Verifying session..." />;
  }

  return isAuthenticated ? <Outlet /> : <Navigate to="/app/login" replace />;
};

export const App = () => (
  <Routes>
    <Route element={<AppShell />}>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app/login" element={<LoginPage />} />
      <Route path="/app/invite/accept" element={<AcceptInvitePage />} />
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
