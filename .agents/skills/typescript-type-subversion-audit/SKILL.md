---
name: typescript-type-subversion-audit
description: Scans TypeScript and TSX code for attempts to bypass the type system, including `as any`, double-casts through `unknown`, redundant assertions, suspicious inline `ReturnType` and `Awaited<ReturnType>` usage, and single-use local wrapper aliases. Use when auditing `src/` for unsafe typing patterns or cleaning up type escapes.
compatibility: Requires Node.js and a project-local `typescript` installation. Defaults to scanning `src/**/*.ts` and `src/**/*.tsx`.
---

# TypeScript Type-System Subversion Audit

Use this skill when you need a report-first pass over `src/` to find likely attempts to bypass or paper over TypeScript's type system.

The bundled analyzer is conservative by default. It reports high-confidence findings for unsafe casts and review-level findings for inline `ReturnType` patterns or single-use wrapper aliases.

## Default workflow

1. Run the analyzer and save a JSON report.

```bash
node .agents/skills/typescript-type-subversion-audit/scripts/find-type-subversions.mjs --source-root src --report /tmp/type-subversions.json
```

2. Read the text summary first, then inspect the JSON report when you need exact paths, lines, symbols, and suggested fixes.

3. Do not edit files immediately unless the user explicitly asked for remediation. This skill is report-first.

4. For borderline findings, read [references/review-guidance.md](references/review-guidance.md) before proposing code changes.

## What it flags

- `as any`
- double-casts through `any` or `unknown`
- redundant assertions where the source type already satisfies the asserted type
- inline `ReturnType<...>` or `Awaited<ReturnType<...>>` annotations that look like one-off local plumbing
- non-exported local type aliases that only wrap `ReturnType<...>` or `Awaited<ReturnType<...>>` and are used once

## Built-in exemptions

- `ReturnType<typeof setTimeout>` and `ReturnType<typeof setInterval>`
- `JSON.parse(...) as unknown`
- `parseYaml(...) as unknown`
- `(await request.json()) as unknown`
- `(await response.json()) as unknown`
- similar `.json()` decode-boundary hardening to `unknown`

## CLI

```bash
node .agents/skills/typescript-type-subversion-audit/scripts/find-type-subversions.mjs --help
```

Supported flags:

- `--project-root <path>`
- `--source-root <path>` default `src`
- `--report <path>`
- `--format text|json` default `text`

## Notes

- The analyzer discovers the repo root by walking upward from the skill directory until it finds both `package.json` and `tsconfig.json`.
- The JSON report is intended to be fed back into follow-up cleanup work.
- If a cast looks like a missing platform typing workaround, treat it as a review item and prefer ambient augmentation or a named adapter type over more casting.
