interface SkeletonProps {
  className?: string;
}

export const Skeleton = ({ className }: SkeletonProps) => (
  <div className={["animate-pulse rounded-xl bg-zinc-800/60", className].filter(Boolean).join(" ")} />
);
