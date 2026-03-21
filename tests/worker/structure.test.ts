import { dirname, join, normalize } from "node:path/posix";
import { describe, it } from "vitest";

const sourceModules = {
  ...import.meta.glob("../../src/contracts/**/*.ts", { eager: true, query: "?raw", import: "default" }),
  ...import.meta.glob("../../src/lib/**/*.ts", { eager: true, query: "?raw", import: "default" }),
  ...import.meta.glob("../../src/worker/**/*.ts", { eager: true, query: "?raw", import: "default" }),
  ...import.meta.glob("../../src/worker/**/*.tsx", { eager: true, query: "?raw", import: "default" }),
} satisfies Record<string, string>;

const extensions = [".ts", ".tsx", ".mts", ".cts"];
const importPattern = /(?:import|export)\s+[\s\S]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const normalizeGlobPath = (value: string): string => value.replace(/^\.\.\/\.\.\//u, "");

const resolveImport = (fromFile: string, specifier: string, fileSet: Set<string>): string | null => {
  if (specifier.startsWith("node:")) {
    return null;
  }

  let normalizedSpecifier = specifier;
  if (normalizedSpecifier.startsWith("@/")) {
    normalizedSpecifier = `src/${normalizedSpecifier.slice(2)}`;
  }

  const candidates: string[] = [];
  if (normalizedSpecifier.startsWith("./") || normalizedSpecifier.startsWith("../")) {
    const base = normalize(join(dirname(fromFile), normalizedSpecifier));
    candidates.push(base, ...extensions.map((extension) => `${base}${extension}`));
    candidates.push(...extensions.map((extension) => join(base, `index${extension}`)));
  } else if (normalizedSpecifier.startsWith("src/")) {
    const base = normalizedSpecifier;
    candidates.push(base, ...extensions.map((extension) => `${base}${extension}`));
    candidates.push(...extensions.map((extension) => join(base, `index${extension}`)));
  } else {
    return null;
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalize(candidate);
    if (fileSet.has(normalizedCandidate)) {
      return normalizedCandidate;
    }
  }

  return null;
};

describe("worker structure", () => {
  it("keeps scoped shared and worker modules free of import cycles", () => {
    const files = Object.keys(sourceModules).map(normalizeGlobPath).sort();
    const fileSet = new Set(files);
    const graph = new Map<string, string[]>();

    for (const file of files) {
      const text = sourceModules[`../../${file}`];
      const dependencies = new Set<string>();

      importPattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = importPattern.exec(text))) {
        const specifier = match[1] ?? match[2];
        const resolvedImport = resolveImport(file, specifier, fileSet);
        if (resolvedImport) {
          dependencies.add(resolvedImport);
        }
      }

      graph.set(file, [...dependencies]);
    }

    const visited = new Set<string>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const cycles: string[][] = [];

    const visit = (node: string): void => {
      visited.add(node);
      stack.push(node);
      onStack.add(node);

      for (const dependency of graph.get(node) ?? []) {
        if (!visited.has(dependency)) {
          visit(dependency);
        } else if (onStack.has(dependency)) {
          const cycleStart = stack.indexOf(dependency);
          cycles.push([...stack.slice(cycleStart), dependency]);
        }
      }

      stack.pop();
      onStack.delete(node);
    };

    for (const file of files) {
      if (!visited.has(file)) {
        visit(file);
      }
    }

    const canonicalCycles = new Map<string, string[]>();
    for (const cycle of cycles) {
      const body = cycle.slice(0, -1);
      let bestKey: string | null = null;
      let bestCycle: string[] | null = null;

      for (let index = 0; index < body.length; index += 1) {
        const rotatedCycle = [...body.slice(index), ...body.slice(0, index)];
        const cycleKey = rotatedCycle.join(" -> ");
        if (bestKey === null || cycleKey < bestKey) {
          bestKey = cycleKey;
          bestCycle = rotatedCycle;
        }
      }

      if (bestKey && bestCycle && !canonicalCycles.has(bestKey)) {
        canonicalCycles.set(bestKey, bestCycle);
      }
    }

    if (canonicalCycles.size > 0) {
      const cycleList = [...canonicalCycles.values()].map((cycle) => cycle.join(" -> ")).join("\n");
      throw new Error(`Import cycles detected:\n${cycleList}`);
    }
  });
});
