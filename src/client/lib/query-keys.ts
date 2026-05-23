export const queryKeys = {
  projectDetail: (projectId: string) => ["project-detail", projectId] as const,
  projectRuns: (projectId: string) => ["project-runs", projectId] as const,
  projectWebhooks: (projectId: string) => ["project-webhooks", projectId] as const,
  projectsRoot: () => ["projects"] as const,
  projects: (userId: string) => ["projects", userId] as const,
  runDetail: (runId: string) => ["run-detail", runId] as const,
} as const;
