#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import prettier from "prettier";
import ts from "typescript";

const PLAN_VERSION = 1;
const INDEX_BASENAMES = new Set(["index.ts", "index.tsx"]);

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();

  if (args.command === "analyze") {
    const analysis = analyzeProject({
      projectRoot,
      rootDir: args.options.root ?? "src",
    });
    await writePlanIfRequested(analysis.plan, args.options.plan);
    process.stdout.write(`${renderAnalysisSummary(analysis)}\n`);
    return;
  }

  if (args.command === "apply") {
    if (!args.options.plan) {
      throw new Error("`apply` requires `--plan <file>`.");
    }

    const plan = JSON.parse(await fs.readFile(args.options.plan, "utf8"));
    validatePlan(plan);

    const applyResult = await applyPlan({
      projectRoot,
      plan,
    });

    process.stdout.write(`${renderApplySummary(applyResult)}\n`);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
};

const parseArgs = (argv) => {
  const [command, ...rest] = argv;
  if (!command) {
    throw new Error("Usage: refactor-imports.mjs <analyze|apply> [--root src] [--plan file]");
  }

  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--root" || token === "--plan") {
      const value = rest[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${token}.`);
      }
      options[token.slice(2)] = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return { command, options };
};

const validatePlan = (plan) => {
  if (!plan || typeof plan !== "object") {
    throw new Error("Invalid plan JSON.");
  }
  if (plan.version !== PLAN_VERSION) {
    throw new Error(`Unsupported plan version: ${plan.version}`);
  }
  if (!Array.isArray(plan.barrelChanges) || !Array.isArray(plan.fileChanges)) {
    throw new Error("Plan is missing required arrays.");
  }
};

const writePlanIfRequested = async (plan, planPath) => {
  if (!planPath) {
    return;
  }
  await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
};

const analyzeProject = ({ projectRoot, rootDir }) => {
  const env = createProjectEnvironment({ projectRoot, rootDir });
  const candidates = collectCollapseCandidates(env);
  const duplicateMergeFiles = collectDuplicateMergeFiles(env);

  const selectedBarrels = new Map();
  const selectedFiles = new Map();
  const blocked = [];

  const sortedCandidates = [...candidates].sort(compareCandidates);
  for (const candidate of sortedCandidates) {
    const decision = trySelectCandidate({
      env,
      selectedBarrels,
      selectedFiles,
      candidate,
    });

    if (!decision.accepted) {
      blocked.push({
        type: "collapse",
        file: candidate.consumerRel,
        directory: candidate.dirRel,
        barrelFile: candidate.barrelRel,
        reason: decision.reason,
      });
    }
  }

  for (const [file, specifiers] of duplicateMergeFiles) {
    const fileState = getOrCreateFileState(selectedFiles, file);
    fileState.mergeDuplicateSpecifiers = [...new Set([...fileState.mergeDuplicateSpecifiers, ...specifiers])].sort();
  }

  const barrelChanges = [...selectedBarrels.values()]
    .filter((state) => state.modulesToAdd.size > 0)
    .map((state) => ({
      barrelFile: state.barrelRel,
      action: state.barrelExists ? "extend" : "create",
      modulesToExport: [...state.finalExportModules].sort(),
      modulesToAdd: [...state.modulesToAdd].sort(),
      consumers: [...state.rewrites.keys()].sort(),
    }))
    .sort(compareByBarrelFile);

  const fileChanges = [...selectedFiles.values()]
    .map((fileState) => ({
      file: fileState.file,
      collapseGroups: [...fileState.barrels.entries()]
        .map(([barrelRel, barrelData]) => ({
          barrelFile: barrelRel,
          barrelSpecifier: barrelData.barrelSpecifier,
          sourceModules: [...barrelData.sourceModules].sort(),
        }))
        .sort((left, right) => left.barrelFile.localeCompare(right.barrelFile)),
      mergeDuplicateSpecifiers: [...new Set(fileState.mergeDuplicateSpecifiers)].sort(),
    }))
    .sort((left, right) => left.file.localeCompare(right.file));

  fileChanges.sort((left, right) => left.file.localeCompare(right.file));

  const plan = {
    version: PLAN_VERSION,
    generatedAt: new Date().toISOString(),
    rootDir,
    tsconfig: path.basename(env.tsconfigPath),
    summary: {
      fileCount: env.fileInfos.size,
      edgeCount: countEdges(env.baseGraph),
      cycleCount: env.baseCycleCount,
      candidateCount: candidates.length,
      barrelChangeCount: barrelChanges.length,
      fileChangeCount: fileChanges.length,
      blockedCount: blocked.length,
    },
    barrelChanges,
    fileChanges,
    blocked,
  };

  return {
    env,
    plan,
  };
};

const compareCandidates = (left, right) => {
  if (left.barrelExists !== right.barrelExists) {
    return left.barrelExists ? -1 : 1;
  }
  if (left.moduleRels.length !== right.moduleRels.length) {
    return right.moduleRels.length - left.moduleRels.length;
  }
  return left.consumerRel.localeCompare(right.consumerRel) || left.dirRel.localeCompare(right.dirRel);
};

const compareByBarrelFile = (left, right) => left.barrelFile.localeCompare(right.barrelFile);

const collectCollapseCandidates = (env) => {
  const candidates = [];

  for (const [consumerRel, fileInfo] of env.fileInfos) {
    const grouped = new Map();

    for (const importRecord of fileInfo.imports) {
      if (importRecord.kind !== "named" || !importRecord.resolvedRel) {
        continue;
      }

      if (INDEX_BASENAMES.has(path.posix.basename(importRecord.resolvedRel))) {
        continue;
      }

      const dirRel = path.posix.dirname(importRecord.resolvedRel);
      if (dirRel === fileInfo.dirRel) {
        continue;
      }

      const barrelRel = getBarrelPath(env, dirRel);
      const barrelSpecifier = getSafeBarrelSpecifier({
        env,
        consumerRel,
        dirRel,
        barrelRel,
        originalSpecifier: importRecord.specifier,
      });
      if (!barrelSpecifier) {
        continue;
      }

      if (!grouped.has(dirRel)) {
        grouped.set(dirRel, {
          dirRel,
          barrelRel,
          barrelExists: env.barrelInfos.has(barrelRel),
          barrelSpecifier,
          moduleToRecords: new Map(),
        });
      }

      const group = grouped.get(dirRel);
      if (group.barrelSpecifier !== barrelSpecifier) {
        group.barrelSpecifier = null;
      }

      if (!group.moduleToRecords.has(importRecord.resolvedRel)) {
        group.moduleToRecords.set(importRecord.resolvedRel, []);
      }
      group.moduleToRecords.get(importRecord.resolvedRel).push(importRecord);
    }

    for (const group of grouped.values()) {
      if (!group.barrelSpecifier) {
        continue;
      }
      if (group.moduleToRecords.size < 2) {
        continue;
      }

      const moduleRels = [...group.moduleToRecords.keys()].sort();
      const requestedImports = [];
      const seenImportedNames = new Map();
      let conflict = null;

      for (const [moduleRel, records] of group.moduleToRecords) {
        for (const record of records) {
          for (const binding of record.bindings) {
            const previousModule = seenImportedNames.get(binding.importedName);
            if (previousModule && previousModule !== moduleRel) {
              conflict = `imported name \`${binding.importedName}\` comes from multiple modules in ${group.dirRel}`;
              break;
            }
            seenImportedNames.set(binding.importedName, moduleRel);
            requestedImports.push({
              fromModule: moduleRel,
              importedName: binding.importedName,
              localName: binding.localName,
              isTypeOnly: binding.isTypeOnly,
            });
          }
          if (conflict) {
            break;
          }
        }
        if (conflict) {
          break;
        }
      }

      if (conflict) {
        continue;
      }

      candidates.push({
        consumerRel,
        dirRel: group.dirRel,
        barrelRel: group.barrelRel,
        barrelExists: group.barrelExists,
        barrelSpecifier: group.barrelSpecifier,
        moduleRels,
        requestedImports,
      });
    }
  }

  return candidates;
};

const collectDuplicateMergeFiles = (env) => {
  const result = new Map();

  for (const [fileRel, fileInfo] of env.fileInfos) {
    const counts = new Map();
    for (const importRecord of fileInfo.imports) {
      if (importRecord.kind !== "named") {
        continue;
      }
      counts.set(importRecord.specifier, (counts.get(importRecord.specifier) ?? 0) + 1);
    }

    const duplicates = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([specifier]) => specifier)
      .sort();

    if (duplicates.length > 0) {
      result.set(fileRel, duplicates);
    }
  }

  return result;
};

const trySelectCandidate = ({ env, selectedBarrels, selectedFiles, candidate }) => {
  if (
    !barrelSpecifierTargetsExpectedFile({
      env,
      consumerRel: candidate.consumerRel,
      barrelRel: candidate.barrelRel,
      specifier: candidate.barrelSpecifier,
    })
  ) {
    const consumerFile = env.fileInfos.get(candidate.consumerRel);
    const collapsedResolution = resolveLocalModule({
      compilerOptions: env.compilerOptions,
      importerFile: consumerFile.sourceFile.fileName,
      specifier: candidate.barrelSpecifier,
      projectRoot: env.projectRoot,
    });
    return {
      accepted: false,
      reason: `collapsed specifier \`${candidate.barrelSpecifier}\` resolves to ${collapsedResolution ?? "a non-local module"} instead of ${candidate.barrelRel}`,
    };
  }

  const barrelInfo = env.barrelInfos.get(candidate.barrelRel) ?? createSyntheticBarrelInfo(candidate.barrelRel);
  const state = getOrCreateBarrelState(selectedBarrels, barrelInfo);

  if (candidate.barrelExists && state.modificationBlocked) {
    const allCovered = candidate.moduleRels.every((moduleRel) => state.finalExportModules.has(moduleRel));
    if (!allCovered) {
      return {
        accepted: false,
        reason: state.modificationBlocked,
      };
    }
  }

  const newModules = candidate.moduleRels.filter((moduleRel) => !state.finalExportModules.has(moduleRel));
  const collisionReason = getCollisionReason({
    env,
    state,
    newModules,
  });
  if (collisionReason) {
    return {
      accepted: false,
      reason: collisionReason,
    };
  }

  const missingExports = getMissingRequestedExports({
    env,
    state,
    candidate,
    newModules,
  });
  if (missingExports.length > 0) {
    return {
      accepted: false,
      reason: `barrel would not expose: ${missingExports.map((name) => `\`${name}\``).join(", ")}`,
    };
  }

  if (
    !isCandidateAcyclic({
      env,
      selectedBarrels,
      candidate,
      newModules,
    })
  ) {
    return {
      accepted: false,
      reason: "simulated rewrite introduces a cycle",
    };
  }

  for (const moduleRel of newModules) {
    state.modulesToAdd.add(moduleRel);
    state.finalExportModules.add(moduleRel);
    addToSet(state.selectedExportNames, env.moduleExports.get(moduleRel)?.names ?? []);
  }

  if (!state.rewrites.has(candidate.consumerRel)) {
    state.rewrites.set(candidate.consumerRel, new Set());
  }
  addToSet(state.rewrites.get(candidate.consumerRel), candidate.moduleRels);

  const fileState = getOrCreateFileState(selectedFiles, candidate.consumerRel);
  if (!fileState.barrels.has(candidate.barrelRel)) {
    fileState.barrels.set(candidate.barrelRel, {
      barrelSpecifier: candidate.barrelSpecifier,
      sourceModules: new Set(),
    });
  }
  addToSet(fileState.barrels.get(candidate.barrelRel).sourceModules, candidate.moduleRels);

  return { accepted: true };
};

const createSyntheticBarrelInfo = (barrelRel) => ({
  fileRel: barrelRel,
  exists: false,
  supportedForRewrite: true,
  unsupportedReason: null,
  exportedModules: new Set(),
  exportedNames: new Set(),
});

const getOrCreateBarrelState = (selectedBarrels, barrelInfo) => {
  if (selectedBarrels.has(barrelInfo.fileRel)) {
    return selectedBarrels.get(barrelInfo.fileRel);
  }

  const state = {
    barrelRel: barrelInfo.fileRel,
    barrelExists: barrelInfo.exists,
    modificationBlocked: barrelInfo.supportedForRewrite ? null : barrelInfo.unsupportedReason,
    existingExportedModules: new Set(barrelInfo.exportedModules),
    finalExportModules: new Set(barrelInfo.exportedModules),
    existingExportNames: new Set(barrelInfo.exportedNames),
    selectedExportNames: new Set(),
    modulesToAdd: new Set(),
    rewrites: new Map(),
  };
  selectedBarrels.set(barrelInfo.fileRel, state);
  return state;
};

const getOrCreateFileState = (selectedFiles, file) => {
  if (selectedFiles.has(file)) {
    return selectedFiles.get(file);
  }
  const state = {
    file,
    barrels: new Map(),
    mergeDuplicateSpecifiers: [],
  };
  selectedFiles.set(file, state);
  return state;
};

const getCollisionReason = ({ env, state, newModules }) => {
  const seenNames = new Set(state.existingExportNames);
  addToSet(seenNames, state.selectedExportNames);

  for (const moduleRel of newModules) {
    const moduleExportInfo = env.moduleExports.get(moduleRel);
    if (!moduleExportInfo) {
      return `could not inspect exports for ${moduleRel}`;
    }

    for (const exportName of moduleExportInfo.names) {
      if (seenNames.has(exportName)) {
        return `export name collision on \`${exportName}\` in ${state.barrelRel}`;
      }
    }

    addToSet(seenNames, moduleExportInfo.names);
  }

  return null;
};

const getMissingRequestedExports = ({ env, state, candidate, newModules }) => {
  const available = new Set(state.existingExportNames);
  addToSet(available, state.selectedExportNames);
  for (const moduleRel of newModules) {
    addToSet(available, env.moduleExports.get(moduleRel)?.names ?? []);
  }

  const missing = new Set();
  for (const request of candidate.requestedImports) {
    if (!available.has(request.importedName)) {
      missing.add(request.importedName);
    }
  }

  return [...missing].sort();
};

const isCandidateAcyclic = ({ env, selectedBarrels, candidate, newModules }) => {
  const simulation = cloneGraph(env.baseGraph);

  for (const state of selectedBarrels.values()) {
    applyBarrelStateToGraph(simulation, state);
  }

  const barrelState = selectedBarrels.get(candidate.barrelRel);
  const tentativeState = {
    barrelRel: candidate.barrelRel,
    barrelExists: candidate.barrelExists,
    modulesToAdd: new Set(barrelState?.modulesToAdd ?? []),
    rewrites: cloneRewriteMap(barrelState?.rewrites),
  };
  addToSet(tentativeState.modulesToAdd, newModules);
  if (!tentativeState.rewrites.has(candidate.consumerRel)) {
    tentativeState.rewrites.set(candidate.consumerRel, new Set());
  }
  addToSet(tentativeState.rewrites.get(candidate.consumerRel), candidate.moduleRels);
  applyBarrelStateToGraph(simulation, tentativeState);

  return countCycles(simulation) === 0;
};

const applyBarrelStateToGraph = (graph, state) => {
  ensureGraphNode(graph, state.barrelRel);
  const barrelDeps = graph.get(state.barrelRel);
  addToSet(barrelDeps, state.modulesToAdd);

  for (const [consumerRel, moduleRels] of state.rewrites.entries()) {
    ensureGraphNode(graph, consumerRel);
    const deps = graph.get(consumerRel);
    for (const moduleRel of moduleRels) {
      deps.delete(moduleRel);
    }
    deps.add(state.barrelRel);
  }
};

const cloneRewriteMap = (rewrites) => {
  const clone = new Map();
  if (!rewrites) {
    return clone;
  }
  for (const [file, modules] of rewrites.entries()) {
    clone.set(file, new Set(modules));
  }
  return clone;
};

const applyPlan = async ({ projectRoot, plan }) => {
  const env = createProjectEnvironment({
    projectRoot,
    rootDir: plan.rootDir ?? "src",
  });

  const touchedFiles = new Set();

  for (const barrelChange of plan.barrelChanges) {
    const barrelText = renderBarrelFile(barrelChange.modulesToExport);
    await writeFormattedText({
      projectRoot,
      fileRel: barrelChange.barrelFile,
      text: barrelText,
    });
    touchedFiles.add(barrelChange.barrelFile);
  }

  for (const fileChange of plan.fileChanges) {
    const sourceFileInfo = env.fileInfos.get(fileChange.file);
    if (!sourceFileInfo) {
      throw new Error(`Plan references missing file: ${fileChange.file}`);
    }

    const updatedText = buildUpdatedSourceText({
      env,
      fileInfo: sourceFileInfo,
      fileChange,
    });
    if (updatedText === sourceFileInfo.text) {
      continue;
    }

    await writeFormattedText({
      projectRoot,
      fileRel: fileChange.file,
      text: updatedText,
    });
    touchedFiles.add(fileChange.file);
  }

  const verification = analyzeProject({
    projectRoot,
    rootDir: plan.rootDir ?? "src",
  });

  return {
    touchedFiles: [...touchedFiles].sort(),
    verification: verification.plan.summary,
  };
};

const renderBarrelFile = (moduleRels) =>
  `${moduleRels
    .map((moduleRel) => `export * from "${toAliasSpecifier(moduleRel)}";`)
    .sort()
    .join("\n")}\n`;

const buildUpdatedSourceText = ({ env, fileInfo, fileChange }) => {
  const collapseByModule = new Map();
  for (const group of fileChange.collapseGroups) {
    for (const moduleRel of group.sourceModules) {
      collapseByModule.set(moduleRel, group.barrelSpecifier);
    }
  }

  const buckets = new Map();
  const removedImportIds = new Set();

  for (const importRecord of fileInfo.imports) {
    if (importRecord.kind === "named") {
      const targetSpecifier = collapseByModule.get(importRecord.resolvedRel) ?? importRecord.specifier;
      const bucket = getOrCreateImportBucket(buckets, targetSpecifier, importRecord.statementIndex);
      addBindingsToBucket(bucket, importRecord.bindings);
      removedImportIds.add(importRecord.id);
      continue;
    }

    if (
      importRecord.kind !== "side-effect" &&
      importRecord.resolvedRel &&
      collapseByModule.has(importRecord.resolvedRel)
    ) {
      throw new Error(`Cannot collapse unsupported import in ${fileInfo.fileRel}: ${importRecord.specifier}`);
    }
  }

  const emitIndexMap = new Map();
  for (const [specifier, bucket] of buckets.entries()) {
    if (!emitIndexMap.has(bucket.emitAt)) {
      emitIndexMap.set(bucket.emitAt, []);
    }
    emitIndexMap.get(bucket.emitAt).push(specifier);
  }
  for (const specifiers of emitIndexMap.values()) {
    specifiers.sort();
  }

  const newStatements = [];
  for (let index = 0; index < fileInfo.sourceFile.statements.length; index += 1) {
    if (emitIndexMap.has(index)) {
      for (const specifier of emitIndexMap.get(index)) {
        newStatements.push(buildMergedImportDeclaration(specifier, buckets.get(specifier).bindings));
      }
    }

    const statement = fileInfo.sourceFile.statements[index];
    if (!ts.isImportDeclaration(statement)) {
      newStatements.push(statement);
      continue;
    }

    const record = fileInfo.importByStatement.get(index);
    if (record && removedImportIds.has(record.id)) {
      continue;
    }

    newStatements.push(statement);
  }

  const updatedSource = ts.factory.updateSourceFile(fileInfo.sourceFile, newStatements);
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
  });
  return printer.printFile(updatedSource);
};

const getOrCreateImportBucket = (buckets, specifier, emitAt) => {
  if (buckets.has(specifier)) {
    const bucket = buckets.get(specifier);
    bucket.emitAt = Math.min(bucket.emitAt, emitAt);
    return bucket;
  }

  const bucket = {
    emitAt,
    bindings: [],
    seen: new Map(),
  };
  buckets.set(specifier, bucket);
  return bucket;
};

const addBindingsToBucket = (bucket, bindings) => {
  for (const binding of bindings) {
    const key = `${binding.importedName}:${binding.localName}`;
    const existingIndex = bucket.seen.get(key);
    if (existingIndex === undefined) {
      bucket.seen.set(key, bucket.bindings.length);
      bucket.bindings.push({ ...binding });
      continue;
    }

    if (!binding.isTypeOnly) {
      bucket.bindings[existingIndex].isTypeOnly = false;
    }
  }
};

const buildMergedImportDeclaration = (specifier, bindings) => {
  const mergedBindings = [...bindings];
  const hasValueBinding = mergedBindings.some((binding) => !binding.isTypeOnly);
  const namedImports = mergedBindings.map((binding) =>
    ts.factory.createImportSpecifier(
      binding.isTypeOnly && hasValueBinding,
      binding.importedName === binding.localName ? undefined : ts.factory.createIdentifier(binding.importedName),
      ts.factory.createIdentifier(binding.localName),
    ),
  );

  const importClause = ts.factory.createImportClause(
    !hasValueBinding,
    undefined,
    ts.factory.createNamedImports(namedImports),
  );

  return ts.factory.createImportDeclaration(
    undefined,
    importClause,
    ts.factory.createStringLiteral(specifier),
    undefined,
  );
};

const writeFormattedText = async ({ projectRoot, fileRel, text }) => {
  const absPath = path.join(projectRoot, fileRel);
  const resolvedConfig = await prettier.resolveConfig(absPath);
  const formatted = await prettier.format(text, {
    ...(resolvedConfig ?? {}),
    filepath: absPath,
  });
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, formatted, "utf8");
};

const createProjectEnvironment = ({ projectRoot, rootDir }) => {
  const tsconfigPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
  if (!tsconfigPath) {
    throw new Error("Could not find tsconfig.json.");
  }

  const configText = ts.sys.readFile(tsconfigPath);
  if (!configText) {
    throw new Error(`Could not read ${tsconfigPath}.`);
  }

  const parsedJson = ts.parseConfigFileTextToJson(tsconfigPath, configText);
  if (parsedJson.error) {
    throw new Error(formatDiagnostic(parsedJson.error));
  }

  const parsedConfig = ts.parseJsonConfigFileContent(parsedJson.config, ts.sys, projectRoot);
  if (parsedConfig.errors.length > 0) {
    throw new Error(parsedConfig.errors.map(formatDiagnostic).join("\n"));
  }

  const normalizedRootDir = toPosix(rootDir.replace(/^\.?\//, ""));
  const rootPrefix = `${normalizedRootDir}/`;
  const sourceFiles = parsedConfig.fileNames.filter((fileName) => {
    const rel = toPosix(path.relative(projectRoot, fileName));
    return rel.startsWith(rootPrefix) && /\.(ts|tsx)$/.test(rel) && !rel.endsWith(".d.ts");
  });

  const host = ts.createCompilerHost(parsedConfig.options, true);
  const program = ts.createProgram(sourceFiles, parsedConfig.options, host);
  const checker = program.getTypeChecker();
  const fileInfos = new Map();
  const barrelInfos = new Map();
  const moduleExports = new Map();
  const baseGraph = new Map();

  for (const sourceFile of program.getSourceFiles()) {
    const fileRel = normalizeSourceFile(projectRoot, sourceFile.fileName);
    if (!fileRel) {
      continue;
    }

    const fileInfo = analyzeSourceFile({
      projectRoot,
      sourceFile,
      compilerOptions: parsedConfig.options,
      checker,
    });
    fileInfos.set(fileRel, fileInfo);
    baseGraph.set(fileRel, new Set(fileInfo.dependencies));
  }

  for (const [fileRel, fileInfo] of fileInfos) {
    moduleExports.set(fileRel, inspectModuleExports(checker, fileInfo.sourceFile));

    if (INDEX_BASENAMES.has(path.posix.basename(fileRel))) {
      const barrelInfo = inspectBarrelFile({
        fileInfo,
        projectRoot,
        compilerOptions: parsedConfig.options,
        checker,
      });
      barrelInfos.set(fileRel, barrelInfo);
    }
  }

  return {
    projectRoot,
    rootDir: normalizedRootDir,
    tsconfigPath,
    compilerOptions: parsedConfig.options,
    checker,
    fileInfos,
    baseGraph,
    baseCycleCount: countCycles(baseGraph),
    barrelInfos,
    moduleExports,
  };
};

const normalizeSourceFile = (projectRoot, fileName) => {
  const rel = toPosix(path.relative(projectRoot, fileName));
  if (!rel.startsWith("src/") || rel.endsWith(".d.ts")) {
    return null;
  }
  return rel;
};

const analyzeSourceFile = ({ projectRoot, sourceFile, compilerOptions, checker }) => {
  const fileRel = toPosix(path.relative(projectRoot, sourceFile.fileName));
  const imports = [];
  const importByStatement = new Map();
  const dependencies = new Set();

  sourceFile.statements.forEach((statement, statementIndex) => {
    const dependency = getDependencyRecord({
      compilerOptions,
      fileName: sourceFile.fileName,
      statement,
      statementIndex,
      projectRoot,
    });

    if (dependency?.resolvedRel) {
      dependencies.add(dependency.resolvedRel);
    }

    if (ts.isImportDeclaration(statement) && dependency) {
      imports.push(dependency);
      importByStatement.set(statementIndex, dependency);
    }
  });

  return {
    fileRel,
    dirRel: path.posix.dirname(fileRel),
    sourceFile,
    text: sourceFile.getFullText(),
    imports,
    importByStatement,
    dependencies,
    checker,
  };
};

const getDependencyRecord = ({ compilerOptions, fileName, statement, statementIndex, projectRoot }) => {
  if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))) {
    return null;
  }

  if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) {
    return null;
  }

  const specifier = statement.moduleSpecifier.text;
  const resolvedRel = resolveLocalModule({
    compilerOptions,
    importerFile: fileName,
    specifier,
    projectRoot,
  });

  if (!ts.isImportDeclaration(statement)) {
    return {
      kind: "export",
      specifier,
      resolvedRel,
      statementIndex,
    };
  }

  const importClause = statement.importClause;
  const baseRecord = {
    id: `${toPosix(path.relative(projectRoot, fileName))}:${statementIndex}`,
    specifier,
    resolvedRel,
    statementIndex,
    node: statement,
  };

  if (!importClause) {
    return {
      ...baseRecord,
      kind: "side-effect",
      bindings: [],
    };
  }

  if (!importClause.name && importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
    const bindings = importClause.namedBindings.elements.map((element) => ({
      importedName: element.propertyName?.text ?? element.name.text,
      localName: element.name.text,
      isTypeOnly: importClause.isTypeOnly || element.isTypeOnly,
    }));
    return {
      ...baseRecord,
      kind: "named",
      bindings,
    };
  }

  return {
    ...baseRecord,
    kind: "unsupported",
    bindings: [],
  };
};

const resolveLocalModule = ({ compilerOptions, importerFile, specifier, projectRoot }) => {
  const resolvedModule = ts.resolveModuleName(specifier, importerFile, compilerOptions, ts.sys).resolvedModule;
  if (!resolvedModule) {
    return null;
  }

  const resolvedRel = toPosix(path.relative(projectRoot, resolvedModule.resolvedFileName));
  if (!resolvedRel.startsWith("src/") || resolvedRel.endsWith(".d.ts")) {
    return null;
  }
  return resolvedRel;
};

const inspectModuleExports = (checker, sourceFile) => {
  const symbol = checker.getSymbolAtLocation(sourceFile) ?? sourceFile.symbol;
  const names = new Set();
  let hasDefault = false;

  if (!symbol) {
    return { names, hasDefault };
  }

  for (const exportSymbol of checker.getExportsOfModule(symbol)) {
    const exportName = exportSymbol.getName();
    if (exportName === "default") {
      hasDefault = true;
      continue;
    }
    names.add(exportName);
  }

  return { names, hasDefault };
};

const inspectBarrelFile = ({ fileInfo, projectRoot, compilerOptions, checker }) => {
  let supportedForRewrite = true;
  let unsupportedReason = null;
  const exportedModules = new Set();

  for (const statement of fileInfo.sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      supportedForRewrite = false;
      unsupportedReason = `existing barrel ${fileInfo.fileRel} is not export-from only`;
      break;
    }

    if (statement.exportClause) {
      supportedForRewrite = false;
      unsupportedReason = `existing barrel ${fileInfo.fileRel} uses named export clauses`;
      break;
    }

    const resolvedRel = resolveLocalModule({
      compilerOptions,
      importerFile: fileInfo.sourceFile.fileName,
      specifier: statement.moduleSpecifier.text,
      projectRoot,
    });
    if (!resolvedRel) {
      supportedForRewrite = false;
      unsupportedReason = `existing barrel ${fileInfo.fileRel} re-exports non-local modules`;
      break;
    }
    exportedModules.add(resolvedRel);
  }

  return {
    fileRel: fileInfo.fileRel,
    exists: true,
    supportedForRewrite,
    unsupportedReason,
    exportedModules,
    exportedNames: inspectModuleExports(checker, fileInfo.sourceFile).names,
  };
};

const getBarrelPath = (env, dirRel) => {
  const tsPath = `${dirRel}/index.ts`;
  if (env.barrelInfos.has(tsPath) || env.fileInfos.has(tsPath)) {
    return tsPath;
  }
  const tsxPath = `${dirRel}/index.tsx`;
  if (env.barrelInfos.has(tsxPath) || env.fileInfos.has(tsxPath)) {
    return tsxPath;
  }
  return tsPath;
};

const getSafeBarrelSpecifier = ({ env, consumerRel, dirRel, barrelRel, originalSpecifier }) => {
  if (originalSpecifier.startsWith("@/")) {
    if (!hasShadowingSiblingSourceFile(env, dirRel)) {
      return toAliasSpecifier(dirRel);
    }
    return toAliasSpecifier(withoutTsExtension(barrelRel));
  }

  if (!originalSpecifier.startsWith(".")) {
    return null;
  }

  let relativePath = toPosix(path.posix.relative(path.posix.dirname(consumerRel), withoutTsExtension(barrelRel)));
  if (relativePath.length === 0) {
    relativePath = ".";
  } else if (!relativePath.startsWith(".")) {
    relativePath = `./${relativePath}`;
  }
  return relativePath;
};

const barrelSpecifierTargetsExpectedFile = ({ env, consumerRel, barrelRel, specifier }) => {
  if (specifier.startsWith("@/")) {
    const normalized = `src/${specifier.slice(2)}`;
    if (normalized === withoutTsExtension(barrelRel)) {
      return true;
    }
    return (
      normalized === path.posix.dirname(barrelRel) && !hasShadowingSiblingSourceFile(env, path.posix.dirname(barrelRel))
    );
  }

  if (!specifier.startsWith(".")) {
    return false;
  }

  const resolved = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(consumerRel), specifier)));
  return resolved === withoutTsExtension(barrelRel);
};

const hasShadowingSiblingSourceFile = (env, dirRel) => {
  const siblingBase = dirRel;
  return env.fileInfos.has(`${siblingBase}.ts`) || env.fileInfos.has(`${siblingBase}.tsx`);
};

const toAliasSpecifier = (relPath) => {
  if (!relPath.startsWith("src/")) {
    throw new Error(`Cannot convert non-src path to alias: ${relPath}`);
  }
  const withoutSourceRoot = withoutTsExtension(relPath.slice("src/".length));
  return `@/${withoutSourceRoot}`;
};

const withoutTsExtension = (value) => value.replace(/\.(ts|tsx)$/, "");

const renderAnalysisSummary = ({ plan }) => {
  const lines = [
    "Import DAG analysis complete.",
    `Files: ${plan.summary.fileCount}`,
    `Edges: ${plan.summary.edgeCount}`,
    `Cycles: ${plan.summary.cycleCount}`,
    `Collapse candidates reviewed: ${plan.summary.candidateCount}`,
    `Barrel changes: ${plan.summary.barrelChangeCount}`,
    `File changes: ${plan.summary.fileChangeCount}`,
    `Blocked candidates: ${plan.summary.blockedCount}`,
  ];

  if (plan.barrelChanges.length > 0) {
    lines.push("", "Planned barrel changes:");
    for (const change of plan.barrelChanges) {
      lines.push(
        `- ${change.action} ${change.barrelFile} for ${change.modulesToAdd.length || change.modulesToExport.length} module(s)`,
      );
    }
  }

  if (plan.fileChanges.length > 0) {
    lines.push("", "Planned file changes:");
    for (const change of plan.fileChanges) {
      const collapseCount = change.collapseGroups.length;
      const mergeCount = change.mergeDuplicateSpecifiers.length;
      lines.push(`- ${change.file}: ${collapseCount} collapse group(s), ${mergeCount} merge-only specifier(s)`);
    }
  }

  if (plan.blocked.length > 0) {
    lines.push("", "Blocked:");
    for (const blocked of plan.blocked.slice(0, 20)) {
      lines.push(`- ${blocked.file} -> ${blocked.directory}: ${blocked.reason}`);
    }
    if (plan.blocked.length > 20) {
      lines.push(`- ... ${plan.blocked.length - 20} more`);
    }
  }

  return lines.join("\n");
};

const renderApplySummary = ({ touchedFiles, verification }) => {
  const lines = [
    "Import plan applied.",
    `Touched files: ${touchedFiles.length}`,
    `Verification cycles: ${verification.cycleCount}`,
    `Verification barrel changes remaining: ${verification.barrelChangeCount}`,
    `Verification file changes remaining: ${verification.fileChangeCount}`,
  ];

  if (touchedFiles.length > 0) {
    lines.push("", "Touched:");
    for (const file of touchedFiles) {
      lines.push(`- ${file}`);
    }
  }

  return lines.join("\n");
};

const countEdges = (graph) => {
  let count = 0;
  for (const deps of graph.values()) {
    count += deps.size;
  }
  return count;
};

const countCycles = (graph) => {
  const visited = new Set();
  const active = new Set();
  let cycles = 0;

  const visit = (node) => {
    visited.add(node);
    active.add(node);

    for (const dependency of graph.get(node) ?? []) {
      if (!graph.has(dependency)) {
        continue;
      }
      if (!visited.has(dependency)) {
        visit(dependency);
        continue;
      }
      if (active.has(dependency)) {
        cycles += 1;
      }
    }

    active.delete(node);
  };

  for (const node of [...graph.keys()].sort()) {
    if (!visited.has(node)) {
      visit(node);
    }
  }

  return cycles;
};

const cloneGraph = (graph) => {
  const clone = new Map();
  for (const [file, deps] of graph.entries()) {
    clone.set(file, new Set(deps));
  }
  return clone;
};

const ensureGraphNode = (graph, node) => {
  if (!graph.has(node)) {
    graph.set(node, new Set());
  }
};

const addToSet = (target, values) => {
  for (const value of values) {
    target.add(value);
  }
};

const toPosix = (value) => value.replaceAll(path.sep, "/");

const formatDiagnostic = (diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
