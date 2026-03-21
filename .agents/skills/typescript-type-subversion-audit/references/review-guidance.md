# Review Guidance

Use this file when a finding needs human judgment before cleanup.

## Finding kinds

- `as-any`
  Remove the cast if the value can stay typed. If the boundary is genuinely dynamic, decode from `unknown` instead of dropping to `any`.

- `double-cast`
  Treat `x as unknown as T` and `x as any as T` as a strong signal that assignability is being bypassed. Prefer a real type conversion, a decoder, or a named adapter type.

- `redundant-assertion`
  If the checker already agrees with the asserted type, remove the assertion. Keep an eye out for casts that only widen or restate the existing type.

- `inline-return-type`
  Review whether the annotation is only plumbing around another function's signature. If so, prefer a semantic local type alias, an exported shared type, or a direct annotation that expresses domain meaning.

- `single-use-wrapper-alias`
  If a local alias only wraps `ReturnType<...>` or `Awaited<ReturnType<...>>` and is used once, either inline it or rename it to reflect domain meaning.

## Expected review-only cases

- Missing platform typings, especially Web/Workers APIs that exist at runtime but are incomplete in `lib.dom.d.ts`, `lib.webworker.d.ts`, or local worker ambient types
- Adapter seams where a named local interface or ambient augmentation would be clearer than another cast
- Interface or method signatures that use `ReturnType<...>` for consistency but may still be intentional

## Preferred remediation order

1. Remove the cast or wrapper if the inferred type is already correct.
2. Replace trust-boundary casts with `unknown` plus a decoder or assertion function.
3. Add or augment ambient typings when the runtime API exists but the platform types are incomplete.
4. Extract a semantic named type when the relationship is real and worth reusing.
