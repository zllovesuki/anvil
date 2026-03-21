import type { ProjectDetail } from "@/contracts";
import { Clock, FileCode, GitBranch, Globe, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { StatusPill } from "@/client/components/status-pill";
import { Card } from "@/client/components/ui";
import { formatTimestamp, inferRepositoryProvider } from "@/client/lib";

export const ProjectMetadataCard = ({
  project,
  settingsHref,
}: {
  project: ProjectDetail["project"];
  settingsHref?: string;
}) => (
  <Card>
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Project overview</p>
        <h1 className="mt-2 text-xl font-semibold text-zinc-100">{project.name}</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          {project.ownerSlug}/{project.projectSlug}
        </p>
      </div>
      <StatusPill status={project.lastRunStatus} />
    </div>

    <div className="mt-4 space-y-1.5 text-sm text-zinc-400">
      <p className="flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        {inferRepositoryProvider(project.repoUrl)}
      </p>
      <p className="flex items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        {project.defaultBranch}
      </p>
      <p className="flex items-center gap-2">
        <FileCode className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span className="font-mono text-xs">{project.configPath}</span>
      </p>
      <p className="flex items-center gap-2 text-zinc-500">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        Updated {formatTimestamp(project.updatedAt)}
      </p>
      {settingsHref ? (
        <Link to={settingsHref} className="flex items-center gap-2 text-zinc-500 transition-colors hover:text-zinc-300">
          <Settings className="h-3.5 w-3.5 shrink-0" />
          Settings
        </Link>
      ) : null}
    </div>
  </Card>
);
