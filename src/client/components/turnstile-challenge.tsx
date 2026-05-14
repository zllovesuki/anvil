import { useQuery } from "@tanstack/react-query";
import { ErrorBanner } from "@/client/components/ui";
import { formatApiError, getApiClient, queryKeys } from "@/client/lib";
import { TurnstileWidget } from "@/client/components/turnstile-widget";

const TURNSTILE_UNAVAILABLE_MESSAGE = "Human verification is temporarily unavailable.";

interface TurnstileChallengeProps {
  action: string;
  onTokenChange: (token: string | null) => void;
  resetKey: number;
}

export const TurnstileChallenge = ({ action, onTokenChange, resetKey }: TurnstileChallengeProps) => {
  const configQuery = useQuery({
    queryKey: queryKeys.appConfig("live"),
    queryFn: () => getApiClient("live").getAppConfig(),
    staleTime: 60 * 1000,
  });

  if (configQuery.isPending) return null;
  if (configQuery.isError) return <ErrorBanner message={formatApiError(configQuery.error)} />;
  if (!configQuery.data.turnstileSiteKey) return <ErrorBanner message={TURNSTILE_UNAVAILABLE_MESSAGE} />;

  return (
    <TurnstileWidget
      action={action}
      onTokenChange={onTokenChange}
      resetKey={resetKey}
      siteKey={configQuery.data.turnstileSiteKey}
    />
  );
};
