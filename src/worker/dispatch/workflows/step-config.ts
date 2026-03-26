const CONTROL_PLANE_STEP_RETRY_LIMIT = 3;
const CONTROL_PLANE_STEP_RETRY_DELAY_MS = 1_000;
const CONTROL_PLANE_STEP_TIMEOUT_MS = 30_000;

// Cloudflare Workflows: retries.limit = total attempts (not retries). limit: 1 = one attempt, zero retries.
export const noRetryStepConfig = (timeoutMs = 10 * 60 * 1_000) => ({
  retries: {
    limit: 1,
    delay: CONTROL_PLANE_STEP_RETRY_DELAY_MS,
  },
  timeout: timeoutMs,
});

export const boundedRetryStepConfig = (timeoutMs = CONTROL_PLANE_STEP_TIMEOUT_MS) => ({
  retries: {
    limit: CONTROL_PLANE_STEP_RETRY_LIMIT,
    delay: CONTROL_PLANE_STEP_RETRY_DELAY_MS,
    backoff: "constant" as const,
  },
  timeout: timeoutMs,
});
