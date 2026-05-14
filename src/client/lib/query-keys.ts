import type { AuthMode } from "@/client/lib/storage";

export const queryKeys = {
  appConfig: (mode: AuthMode) => ["app-config", mode] as const,
  projectDetail: (mode: AuthMode, projectId: string) => ["project-detail", mode, projectId] as const,
  projectRuns: (mode: AuthMode, projectId: string) => ["project-runs", mode, projectId] as const,
  projectWebhooks: (mode: AuthMode, projectId: string) => ["project-webhooks", mode, projectId] as const,
  projectsRoot: (mode: AuthMode) => ["projects", mode] as const,
  projects: (mode: AuthMode, userId: string) => ["projects", mode, userId] as const,
  runDetail: (mode: AuthMode, runId: string) => ["run-detail", mode, runId] as const,
} as const;
