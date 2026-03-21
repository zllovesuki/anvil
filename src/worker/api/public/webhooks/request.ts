import { matchesWebhookRequestContentType, type WebhookProviderCatalogEntry } from "@/lib/webhooks";
import { assertValidSlug } from "@/worker/validation";
import { HttpError } from "@/worker/http";

export interface ParsedWebhookRequestHeaders {
  deliveryId: string;
  eventName: string;
  verificationHeader: string;
}

export const requirePublicSlug = (value: string | undefined, fieldName: string): string => {
  if (!value) {
    throw new HttpError(404, "webhook_not_found", "Webhook was not found.");
  }

  assertValidSlug(value, fieldName);
  return value;
};

export const assertExpectedWebhookContentType = (catalog: WebhookProviderCatalogEntry, request: Request): void => {
  if (!matchesWebhookRequestContentType(catalog, request.headers.get("content-type"))) {
    throw new HttpError(415, "unsupported_media_type", `Webhook requests must use ${catalog.expectedContentType}.`);
  }
};

export const requireHeader = (request: Request, headerName: string): string => {
  const value = request.headers.get(headerName)?.trim();
  if (!value) {
    throw new HttpError(401, "invalid_webhook_signature", `Missing required header ${headerName}.`);
  }

  return value;
};

export const requireAnyHeader = (request: Request, headerNames: readonly string[]): string => {
  for (const headerName of headerNames) {
    const value = request.headers.get(headerName)?.trim();
    if (value) {
      return value;
    }
  }

  throw new HttpError(401, "invalid_webhook_signature", `Missing required header ${headerNames.join(" or ")}.`);
};

export const readWebhookRequestHeaders = (
  request: Request,
  catalog: WebhookProviderCatalogEntry,
): ParsedWebhookRequestHeaders => {
  const requiredHeaderValues = new Map<string, string>();
  for (const headerName of catalog.requiredHeaders) {
    requiredHeaderValues.set(headerName, requireHeader(request, headerName));
  }

  return {
    deliveryId: requireAnyHeader(request, catalog.deliveryIdHeaders),
    eventName: requiredHeaderValues.get(catalog.eventHeader) ?? requireHeader(request, catalog.eventHeader),
    verificationHeader:
      requiredHeaderValues.get(catalog.verificationHeader) ?? requireHeader(request, catalog.verificationHeader),
  };
};
