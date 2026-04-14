import { FileQuestion } from "lucide-react";
import { ButtonLink } from "@/client/components/ui";

export const NotFoundPage = () => (
  <div className="flex min-h-[60vh] animate-slide-up flex-col items-center justify-center text-center">
    <div className="mb-6 inline-flex rounded-2xl bg-zinc-800/60 p-4 text-zinc-400">
      <FileQuestion className="h-10 w-10" />
    </div>
    <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Page not found</h1>
    <p className="mt-3 max-w-md text-sm leading-6 text-zinc-400">
      The page you're looking for doesn't exist or has been moved.
    </p>
    <ButtonLink to="/" variant="secondary" className="mt-6">
      Back to home
    </ButtonLink>
  </div>
);
