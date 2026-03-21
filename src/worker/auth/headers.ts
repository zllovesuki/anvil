import { HttpError } from "@/worker/http";

const BEARER_PREFIX = "Bearer ";

export const getBearerToken = (request: Request): string | null => {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith(BEARER_PREFIX)) {
    return null;
  }

  return authorization.slice(BEARER_PREFIX.length).trim() || null;
};

export const requireBearerToken = (request: Request): string => {
  const token = getBearerToken(request);

  if (!token) {
    throw new HttpError(403, "missing_authorization", "Missing bearer authorization.");
  }

  return token;
};
