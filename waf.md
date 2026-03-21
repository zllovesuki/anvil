# anvil rate limiting

anvil uses two layers for public-route abuse control:

- Cloudflare WAF rate limiting rules for the coarse outer boundary on `/api/public/*`
- Workers rate limiting bindings for narrow, application-aware throttling on brute-forceable auth flows

## Outer WAF rule

Keep one WAF rate limiting rule on the public API prefix:

```txt
starts_with(http.request.uri.path, "/api/public/")
```

This is the primary public edge control for:

- login brute force
- invite acceptance abuse
- webhook spray
- future public auth flows

Why WAF remains primary:

- it protects the whole public prefix before worker code runs
- it matches the current anvil spec
- the Workers binding is per-location and eventually consistent, so it is not a good replacement for a coarse edge rule

Relevant docs:

- https://developers.cloudflare.com/waf/rate-limiting-rules/
- https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

## Workers bindings

Wrangler config defines two auth-specific bindings:

- `PUBLIC_LOGIN_RATE_LIMITER`
  - `namespace_id = "1101"`
  - `10` requests per `60` seconds
  - key: `login:${sha256(normalizedEmail)}`
- `PUBLIC_INVITE_ACCEPT_RATE_LIMITER`
  - `namespace_id = "1102"`
  - `5` requests per `60` seconds
  - key: `invite_accept:${sha256(token)}`

These bindings intentionally apply only to:

- `POST /api/public/auth/login`
- `POST /api/public/auth/invite/accept`

They do not apply to:

- `POST /api/public/auth/logout`
- `POST /api/public/hooks/:provider/:ownerSlug/:projectSlug`

## Why webhooks are excluded

Webhook ingress already sits behind the coarse WAF boundary and has provider-specific retry semantics after verification. The Workers binding is not used there because:

- webhook traffic is provider-driven, not user-driven
- the binding is local to a Cloudflare location and eventually consistent
- webhook failure handling already uses application responses like `503` plus `Retry-After` for `queue_full`

## Observability

Workers rate limiting bindings are not visible in the Cloudflare dashboard. Monitor them through Workers logs.

The worker emits:

- `public_rate_limited`

with the request method, path, and limiter name when a binding blocks a request.

## Operational notes

- Rate limit namespace IDs are account-global. If `1101` or `1102` is already used in the Cloudflare account, update both `wrangler.jsonc` and this file together.
- Wrangler does not inherit `ratelimits` into named environments automatically. If named environments are added later, duplicate the binding config explicitly.
