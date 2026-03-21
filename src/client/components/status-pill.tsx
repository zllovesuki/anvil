import type { RunStatus } from "@/contracts";
import { getStatusMeta } from "@/client/lib";

export const StatusPill = ({ status }: { status: RunStatus | null }) => {
  const meta = getStatusMeta(status);

  return (
    <span
      className={["inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium", meta.tone].join(
        " ",
      )}
    >
      <span className={["h-2 w-2 rounded-full", meta.dot].join(" ")} />
      {meta.label}
    </span>
  );
};
