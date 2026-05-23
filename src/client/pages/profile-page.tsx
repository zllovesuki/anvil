import { Calendar, Mail, User } from "lucide-react";
import { useAuth } from "@/client/auth";
import { Card, PageHeader } from "@/client/components/ui";
import { formatTimestamp } from "@/client/lib";

export const ProfilePage = () => {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="animate-slide-up space-y-6">
      <PageHeader label="Account" title="Profile & Settings" />

      <div className="grid gap-5">
        {/* User info card */}
        <Card>
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-500/15 text-accent-400">
              <User className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-semibold text-zinc-100">{user.displayName}</h1>
              <p className="mt-0.5 text-sm text-zinc-500">@{user.slug}</p>
            </div>
          </div>

          <dl className="mt-6 space-y-4 text-sm">
            <div className="flex items-center gap-3 text-zinc-400">
              <Mail className="h-4 w-4 shrink-0 text-zinc-500" />
              <div>
                <dt className="text-xs uppercase tracking-[0.18em] text-zinc-500">Email</dt>
                <dd className="mt-0.5 text-zinc-300">{user.email}</dd>
              </div>
            </div>
            <div className="flex items-center gap-3 text-zinc-400">
              <Calendar className="h-4 w-4 shrink-0 text-zinc-500" />
              <div>
                <dt className="text-xs uppercase tracking-[0.18em] text-zinc-500">Member since</dt>
                <dd className="mt-0.5 text-zinc-300">{formatTimestamp(user.createdAt)}</dd>
              </div>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
};
