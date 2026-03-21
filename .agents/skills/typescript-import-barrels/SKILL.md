---
name: typescript-import-barrels
description: Build a resolved import DAG for `src/**/*.ts` and `src/**/*.tsx`, identify safe barrel opportunities, conservatively add or extend `index.ts` barrels without introducing cycles, and merge or collapse imports. Use when refactoring TypeScript imports in this repo or when the user asks to reduce import fan-out under `src/`.
compatibility: Designed for this repo. Requires Node.js, the installed `typescript` and `prettier` packages, and the repo `tsconfig.json` path aliases.
---

# TypeScript Import Barrels

Use this skill for import cleanup under `src/` in this repo.

The bundled script is deterministic and TypeScript-aware. It resolves modules through the repo `tsconfig.json`, treats the current `src/` graph as a DAG invariant, and only proposes conservative barrel rewrites.

## Default workflow

1. Run analysis first.

```bash
node .agents/skills/typescript-import-barrels/scripts/refactor-imports.mjs analyze --root src --plan /tmp/import-plan.json
```

2. Read the summary and the saved plan.

The analysis reports:

- file count, edge count, and cycle count for the resolved `src/` graph
- proposed barrel creates or extensions
- proposed file rewrites
- blocked candidates with explicit reasons

3. In this repo, default to review-first behavior.

Do not edit files immediately after analysis unless the user asked for it. Show the planned barrel changes and file rewrites first, then apply the saved plan only after approval.

4. Apply the approved plan.

```bash
node .agents/skills/typescript-import-barrels/scripts/refactor-imports.mjs apply --plan /tmp/import-plan.json
```

5. Re-run analysis after apply to confirm the graph is still acyclic.

## Safety rules

- Only touch `src/**/*.ts` and `src/**/*.tsx`.
- Never rewrite a file to import from the barrel in its own directory.
- Only create or extend a barrel when it immediately collapses imports from at least two modules in the same directory for a consumer.
- Preserve side-effect imports.
- Merge duplicate named imports from the same specifier when safe.
- Merge split type and value named imports from the same specifier when safe under `verbatimModuleSyntax`.
- Keep each consumer's import style. Prefer the directory alias or directory-relative specifier first, but fall back to an explicit `/index` specifier when the plain directory would resolve somewhere else.
- Block, do not guess, when a candidate depends on unsupported default or namespace imports, export-name collisions, unresolved modules, or a simulated cycle.

## Barrel conventions

- Use `index.ts` for new barrels.
- For `index.ts` barrels under `src/`, use the repo's existing style:

```ts
export * from "@/client/lib/api";
```

- When extending an existing barrel, keep exports sorted by specifier and do not rewrite unrelated files.

## Notes

- The script writes a JSON plan file. Keep that file and apply the exact reviewed plan.
- If analysis reports zero safe rewrites, stop there instead of forcing barrel creation.
