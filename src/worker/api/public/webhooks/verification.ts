import type { WebhookProviderCatalogEntry } from "@/lib/webhooks";
import type { WebhookProvider as WebhookProviderValue } from "@/contracts";
import type { WebhookTriggerPayload } from "@/worker/contracts";
import { decryptSecret } from "@/worker/security/secrets";
import { timingSafeEqual, toArrayBuffer } from "@/worker/services/crypto";
import type { WebhookVerificationMaterial } from "@/worker/durable/project-do/webhooks/types";
import { HttpError } from "@/worker/http";

import { parseJsonObject, webhookPayloadNormalizers } from "./payload";
import { readWebhookRequestHeaders } from "./request";

const textEncoder = new TextEncoder();

const fromHex = (value: string): Uint8Array => {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/iu.test(value)) {
    throw new HttpError(401, "invalid_webhook_signature", "Webhook signature is invalid.");
  }

  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    output[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }

  return output;
};

const verifySharedSecret = (provided: string, expected: string): void => {
  if (!timingSafeEqual(textEncoder.encode(provided), textEncoder.encode(expected))) {
    throw new HttpError(401, "invalid_webhook_signature", "Webhook signature is invalid.");
  }
};

const signHmacSha256 = async (secret: string, body: Uint8Array): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, toArrayBuffer(body));
  return new Uint8Array(signature);
};

const verifyHmacSha256Hex = async (providedHex: string, secret: string, body: Uint8Array): Promise<void> => {
  const expected = await signHmacSha256(secret, body);
  const provided = fromHex(providedHex);
  if (!timingSafeEqual(provided, expected)) {
    throw new HttpError(401, "invalid_webhook_signature", "Webhook signature is invalid.");
  }
};

const verifyWebhookSignature = async (
  catalog: WebhookProviderCatalogEntry,
  verificationHeader: string,
  secret: string,
  body: Uint8Array,
): Promise<void> => {
  switch (catalog.verificationKind) {
    case "shared-secret":
      verifySharedSecret(verificationHeader, secret);
      return;
    case "hmac-sha256": {
      const providedHex =
        catalog.verificationPrefix === null
          ? verificationHeader
          : verificationHeader.startsWith(catalog.verificationPrefix)
            ? verificationHeader.slice(catalog.verificationPrefix.length)
            : null;
      if (providedHex === null) {
        throw new HttpError(401, "invalid_webhook_signature", "Webhook signature is invalid.");
      }

      await verifyHmacSha256Hex(providedHex, secret, body);
    }
  }
};

export const verifyProviderWebhook = async (
  provider: WebhookProviderValue,
  catalog: WebhookProviderCatalogEntry,
  env: Env,
  request: Request,
  material: WebhookVerificationMaterial,
  body: Uint8Array,
): Promise<WebhookTriggerPayload> => {
  const requestHeaders = readWebhookRequestHeaders(request, catalog);
  const secret = await decryptSecret(env, material.encryptedSecret);
  await verifyWebhookSignature(catalog, requestHeaders.verificationHeader, secret, body);
  const payload = parseJsonObject(body);

  return {
    ...webhookPayloadNormalizers[provider](payload, requestHeaders.eventName),
    deliveryId: requestHeaders.deliveryId,
  };
};
