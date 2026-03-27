interface SkeletonProps {
  className?: string;
}

export const Skeleton = ({ className }: SkeletonProps) => (
  <div
    className={[
      "bg-gradient-to-r from-zinc-800/0 via-zinc-700/40 to-zinc-800/0 bg-[length:200%_100%] animate-shimmer rounded-lg",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
  />
);
