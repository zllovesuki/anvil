#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HELP_TEXT = `Usage: find-type-subversions.mjs [--project-root <path>] [--source-root <path>] [--report <path>] [--format <text|json>]

Scans TypeScript and TSX files for likely attempts to subvert the type system.

Options:
  --project-root <path>  Override auto-detected repo root
  --source-root <path>   Source directory to scan relative to project root (default: src)
  --report <path>        Write the JSON report to a file
  --format <text|json>   Output format for stdout (default: text)
  --help                 Show this help text
`;

class UsageError extends Error {}

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = options.projectRoot
    ? path.resolve(process.cwd(), options.projectRoot)
    : detectProjectRoot(scriptDir);
  const sourceRootAbs = path.resolve(projectRoot, options.sourceRoot);
  const sourceRootRel = toPosix(path.relative(projectRoot, sourceRootAbs)) || ".";

  const { program, checker, tsconfigPath } = createProgramForProject(projectRoot);
  const sourceFiles = program
    .getSourceFiles()
    .filter(
      (sourceFile) =>
        !sourceFile.isDeclarationFile &&
        isWithinDir(sourceFile.fileName, sourceRootAbs) &&
        !sourceFile.fileName.includes(`${path.sep}node_modules${path.sep}`),
    );

  const findings = sourceFiles.flatMap((sourceFile) =>
    analyzeSourceFile({
      checker,
      projectRoot,
      sourceFile,
    }),
  );

  findings.sort(compareFindings);

  const summary = buildSummary({
    findings,
    filesScanned: sourceFiles.length,
  });

  const report = {
    projectRoot: toPosix(projectRoot),
    sourceRoot: sourceRootRel,
    tsconfig: path.basename(tsconfigPath),
    summary,
    findings,
  };

  if (options.report) {
    const reportPath = path.resolve(process.cwd(), options.report);
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderTextReport(report)}\n`);
};

const parseArgs = (argv) => {
  const options = {
    format: "text",
    help: false,
    projectRoot: null,
    report: null,
    sourceRoot: "src",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help") {
      options.help = true;
      continue;
    }

    if (token === "--project-root" || token === "--source-root" || token === "--report" || token === "--format") {
      const value = argv[index + 1];
      if (!value) {
        throw new UsageError(`Missing value for ${token}.`);
      }
      options[token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
      continue;
    }

    throw new UsageError(`Unknown argument: ${token}`);
  }

  if (!["text", "json"].includes(options.format)) {
    throw new UsageError(`Unsupported format: ${options.format}`);
  }

  return options;
};

const detectProjectRoot = (startDir) => {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (
      ts.sys.fileExists(path.join(currentDir, "package.json")) &&
      ts.sys.fileExists(path.join(currentDir, "tsconfig.json"))
    ) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("Could not auto-detect the project root from the skill directory.");
    }
    currentDir = parentDir;
  }
};

const createProgramForProject = (projectRoot) => {
  const tsconfigPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
  if (!tsconfigPath) {
    throw new Error(`Could not find tsconfig.json under ${projectRoot}.`);
  }

  const configResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configResult.error) {
    throw new Error(formatDiagnostic(configResult.error));
  }

  const parsedConfig = ts.parseJsonConfigFileContent(configResult.config, ts.sys, projectRoot, undefined, tsconfigPath);
  if (parsedConfig.errors.length > 0) {
    throw new Error(parsedConfig.errors.map(formatDiagnostic).join("\n"));
  }

  const program = ts.createProgram({
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options,
    projectReferences: parsedConfig.projectReferences,
  });

  return {
    program,
    checker: program.getTypeChecker(),
    tsconfigPath,
  };
};

const analyzeSourceFile = ({ checker, projectRoot, sourceFile }) => {
  const findings = [];

  const visit = (node) => {
    if (isAssertionExpression(node)) {
      if (isDoubleCastRoot(node)) {
        const finding = analyzeDoubleCast({
          checker,
          projectRoot,
          sourceFile,
          node,
        });
        if (finding) {
          findings.push(finding);
        }
      } else if (!isNestedAssertion(node)) {
        const asAnyFinding = analyzeAsAny({
          checker,
          projectRoot,
          sourceFile,
          node,
        });
        if (asAnyFinding) {
          findings.push(asAnyFinding);
        } else {
          const redundantFinding = analyzeRedundantAssertion({
            checker,
            projectRoot,
            sourceFile,
            node,
          });
          if (redundantFinding) {
            findings.push(redundantFinding);
          }
        }
      }
    }

    if (ts.isTypeAliasDeclaration(node)) {
      const singleUseAliasFinding = analyzeSingleUseWrapperAlias({
        checker,
        projectRoot,
        sourceFile,
        node,
      });
      if (singleUseAliasFinding) {
        findings.push(singleUseAliasFinding);
      }
    }

    if (isOutermostReturnPatternNode(node)) {
      const inlineReturnTypeFinding = analyzeInlineReturnType({
        checker,
        projectRoot,
        sourceFile,
        node,
      });
      if (inlineReturnTypeFinding) {
        findings.push(inlineReturnTypeFinding);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
};

const analyzeAsAny = ({ checker, projectRoot, sourceFile, node }) => {
  if (!isAnyTypeNode(node.type) || isConstAssertion(node)) {
    return null;
  }

  const platformWorkaround = isLikelyPlatformTypingWorkaround({
    checker,
    sourceFile,
    expression: unwrapExpression(node.expression),
  });

  return createFinding({
    kind: "as-any",
    confidence: platformWorkaround ? "review" : "high",
    projectRoot,
    sourceFile,
    node,
    message: platformWorkaround
      ? "Cast to `any` looks like a platform typing workaround."
      : "Cast to `any` discards type safety.",
    symbol: getNearestNamedSymbol(node),
    suggestedFix: platformWorkaround
      ? "Prefer ambient augmentation or a named adapter type over casting a platform API to `any`."
      : "Keep the value typed, or move the boundary to `unknown` plus an explicit decoder.",
  });
};

const analyzeDoubleCast = ({ checker, projectRoot, sourceFile, node }) => {
  const chain = flattenAssertionChain(node);
  if (chain.length < 2) {
    return null;
  }

  const anyOrUnknownSteps = chain.filter((step) => isAnyOrUnknownTypeNode(step.typeNode));
  if (anyOrUnknownSteps.length === 0) {
    return null;
  }

  const baseExpression = unwrapExpression(chain[0].expression);
  const throughTypes = anyOrUnknownSteps.map((step) => renderTypeNode(step.typeNode)).join(", ");
  const platformWorkaround = isLikelyPlatformTypingWorkaround({
    checker,
    sourceFile,
    expression: baseExpression,
  });

  return createFinding({
    kind: "double-cast",
    confidence: platformWorkaround ? "review" : "high",
    projectRoot,
    sourceFile,
    node,
    message: platformWorkaround
      ? `Double-cast through ${throughTypes} looks like a platform typing workaround.`
      : `Double-cast through ${throughTypes} hides an assignability mismatch.`,
    symbol: getNearestNamedSymbol(node),
    suggestedFix: platformWorkaround
      ? "Prefer ambient augmentation or a named adapter type instead of double-casting a platform API."
      : "Replace the double-cast with a real conversion, decoder, or semantically named adapter type.",
  });
};

const analyzeRedundantAssertion = ({ checker, projectRoot, sourceFile, node }) => {
  if (isConstAssertion(node) || isAnyTypeNode(node.type)) {
    return null;
  }

  if (isBoundarySource(unwrapExpression(node.expression)) || isBoundaryHardeningCast({ checker, node })) {
    return null;
  }

  const sourceExpression = unwrapExpression(node.expression);
  const sourceType = checker.getTypeAtLocation(sourceExpression);
  const targetType = checker.getTypeFromTypeNode(node.type);

  if (isAnyOrUnknownType(sourceType) || isAnyOrUnknownType(targetType)) {
    if (!(isUnknownTypeNode(node.type) && !isBoundarySource(sourceExpression))) {
      return null;
    }
  }

  if (!checker.isTypeAssignableTo(sourceType, targetType) || !checker.isTypeAssignableTo(targetType, sourceType)) {
    return null;
  }

  const sourceText = checker.typeToString(sourceType, sourceExpression, ts.TypeFormatFlags.NoTruncation);
  const targetText = checker.typeToString(targetType, node.type, ts.TypeFormatFlags.NoTruncation);

  return createFinding({
    kind: "redundant-assertion",
    confidence: "high",
    projectRoot,
    sourceFile,
    node,
    message: `Assertion restates the existing type (${sourceText} -> ${targetText}).`,
    symbol: getNearestNamedSymbol(node),
    suggestedFix: "Remove the assertion unless it documents a real runtime conversion.",
  });
};

const analyzeInlineReturnType = ({ checker, projectRoot, sourceFile, node }) => {
  const pattern = getReturnPattern(node);
  if (!pattern || isTimerHandlePattern(pattern)) {
    return null;
  }

  const context = resolveTypeUseContext(node);
  if (!context) {
    return null;
  }

  if (isGenericBoundary(context.container)) {
    return null;
  }

  return createFinding({
    kind: "inline-return-type",
    confidence: "review",
    projectRoot,
    sourceFile,
    node,
    message: `${renderReturnPattern(pattern)} is used inline as local type plumbing.`,
    symbol: context.symbol,
    suggestedFix: "Consider a semantic named type, a shared exported type, or a simpler direct annotation.",
  });
};

const analyzeSingleUseWrapperAlias = ({ checker, projectRoot, sourceFile, node }) => {
  if (hasExportModifier(node)) {
    return null;
  }

  const pattern = getReturnPattern(node.type);
  if (!pattern || isTimerHandlePattern(pattern)) {
    return null;
  }

  const symbol = checker.getSymbolAtLocation(node.name);
  if (!symbol) {
    return null;
  }

  const usageCount = countSymbolReferencesInFile({
    checker,
    sourceFile,
    symbol,
  });
  if (usageCount !== 1) {
    return null;
  }

  return createFinding({
    kind: "single-use-wrapper-alias",
    confidence: "review",
    projectRoot,
    sourceFile,
    node: node.name,
    message: `Local alias \`${node.name.text}\` only wraps ${renderReturnPattern(pattern)} and is used once.`,
    symbol: node.name.text,
    suggestedFix: "Inline the alias or rename it to express domain meaning instead of source-signature plumbing.",
  });
};

const buildSummary = ({ findings, filesScanned }) => {
  const byKind = {};
  let highConfidence = 0;
  let review = 0;

  for (const finding of findings) {
    byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;
    if (finding.confidence === "high") {
      highConfidence += 1;
    } else {
      review += 1;
    }
  }

  return {
    filesScanned,
    findings: findings.length,
    highConfidence,
    review,
    byKind,
  };
};

const renderTextReport = (report) => {
  const lines = [
    `Scanned ${report.summary.filesScanned} files under ${report.sourceRoot}`,
    `Findings: ${report.summary.findings} (${report.summary.highConfidence} high, ${report.summary.review} review)`,
  ];

  const kindEntries = Object.entries(report.summary.byKind).sort(([left], [right]) => left.localeCompare(right));
  if (kindEntries.length > 0) {
    lines.push(`By kind: ${kindEntries.map(([kind, count]) => `${kind}=${count}`).join(", ")}`);
  }

  if (report.findings.length === 0) {
    lines.push("No findings.");
    return lines.join("\n");
  }

  lines.push("");
  for (const finding of report.findings) {
    lines.push(
      `${finding.path}:${finding.line}:${finding.column} [${finding.confidence}] ${finding.kind} - ${finding.message}`,
    );
    if (finding.symbol) {
      lines.push(`  symbol: ${finding.symbol}`);
    }
    lines.push(`  evidence: ${finding.evidence}`);
    lines.push(`  suggested fix: ${finding.suggestedFix}`);
  }

  return lines.join("\n");
};

const createFinding = ({ kind, confidence, projectRoot, sourceFile, node, message, symbol, suggestedFix }) => {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    kind,
    confidence,
    path: toPosix(path.relative(projectRoot, sourceFile.fileName)),
    line: start.line + 1,
    column: start.character + 1,
    ...(symbol ? { symbol } : {}),
    message,
    evidence: getEvidenceLine(sourceFile, node.getStart(sourceFile)),
    suggestedFix,
  };
};

const compareFindings = (left, right) =>
  left.path.localeCompare(right.path) ||
  left.line - right.line ||
  left.column - right.column ||
  left.kind.localeCompare(right.kind);

const countSymbolReferencesInFile = ({ checker, sourceFile, symbol }) => {
  let count = 0;

  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      checker.getSymbolAtLocation(node) === symbol &&
      node !== symbol.valueDeclaration?.name
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return count;
};

const isDoubleCastRoot = (node) =>
  isAssertionExpression(node) && isAssertionExpression(unwrapExpression(node.expression));

const isNestedAssertion = (node) => isAssertionExpression(node.parent);

const flattenAssertionChain = (node) => {
  const chain = [];
  let current = node;

  while (isAssertionExpression(current)) {
    chain.unshift({
      node: current,
      typeNode: current.type,
      expression: current.expression,
    });
    current = unwrapExpression(current.expression);
  }

  return chain;
};

const isAssertionExpression = (node) => ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);

const isConstAssertion = (node) =>
  node.type.kind === ts.SyntaxKind.ConstType ||
  (ts.isTypeReferenceNode(node.type) && isIdentifierNamed(node.type.typeName, "const"));

const unwrapExpression = (expression) => {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
};

const isBoundaryHardeningCast = ({ checker, node }) =>
  isUnknownTypeNode(node.type) &&
  isBoundarySource(unwrapExpression(node.expression)) &&
  isAnyOrUnknownType(checker.getTypeAtLocation(node.expression));

const isBoundarySource = (expression) => {
  let current = unwrapExpression(expression);

  while (ts.isAwaitExpression(current)) {
    current = unwrapExpression(current.expression);
  }

  if (!ts.isCallExpression(current)) {
    return false;
  }

  const callee = unwrapExpression(current.expression);
  if (ts.isIdentifier(callee) && ["parseYaml", "parseYAML"].includes(callee.text)) {
    return true;
  }

  if (ts.isPropertyAccessExpression(callee) && callee.name.text === "json") {
    return true;
  }

  return isJsonParseCall(current);
};

const isJsonParseCall = (node) =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "JSON" &&
  node.expression.name.text === "parse";

const isLikelyPlatformTypingWorkaround = ({ checker, sourceFile, expression }) => {
  const rootIdentifier = getRootIdentifier(expression);
  if (!rootIdentifier) {
    return false;
  }

  const symbol = checker.getSymbolAtLocation(rootIdentifier);
  const declarationFiles = symbol?.declarations?.map((declaration) => declaration.getSourceFile().fileName) ?? [];
  if (
    declarationFiles.some(
      (fileName) =>
        fileName.includes(`${path.sep}typescript${path.sep}lib${path.sep}lib.`) ||
        fileName.endsWith(`${path.sep}worker-configuration.d.ts`),
    )
  ) {
    return true;
  }

  const rootText = rootIdentifier.text;
  if (["crypto", "navigator", "window", "document", "performance", "location"].includes(rootText)) {
    return true;
  }

  const expressionText = expression.getText(sourceFile);
  return /^(globalThis\.)?(crypto|navigator|window|document|performance|location)\b/.test(expressionText);
};

const getRootIdentifier = (expression) => {
  let current = unwrapExpression(expression);

  while (true) {
    if (ts.isPropertyAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isElementAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isCallExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    return ts.isIdentifier(current) ? current : null;
  }
};

const getReturnPattern = (node) => {
  if (!ts.isTypeNode(node)) {
    return null;
  }

  if (isAwaitedReturnPattern(node)) {
    return {
      kind: "awaited-return-type",
      node,
      innerReturnType: node.typeArguments[0],
    };
  }

  if (isReturnTypeNode(node)) {
    return {
      kind: "return-type",
      node,
      innerReturnType: node,
    };
  }

  return null;
};

const isOutermostReturnPatternNode = (node) => {
  if (!ts.isTypeNode(node)) {
    return false;
  }

  const pattern = getReturnPattern(node);
  if (!pattern) {
    return false;
  }

  return !ts.isTypeNode(node.parent) || !getReturnPattern(node.parent);
};

const isAwaitedReturnPattern = (node) =>
  ts.isTypeReferenceNode(node) &&
  isIdentifierNamed(node.typeName, "Awaited") &&
  node.typeArguments?.length === 1 &&
  isReturnTypeNode(node.typeArguments[0]);

const isReturnTypeNode = (node) =>
  ts.isTypeReferenceNode(node) &&
  isIdentifierNamed(node.typeName, "ReturnType") &&
  (node.typeArguments?.length ?? 0) === 1;

const renderReturnPattern = (pattern) =>
  pattern.kind === "awaited-return-type" ? "`Awaited<ReturnType<...>>`" : "`ReturnType<...>`";

const isTimerHandlePattern = (pattern) => {
  const returnTypeNode = pattern.innerReturnType;
  if (!isReturnTypeNode(returnTypeNode)) {
    return false;
  }

  const [argument] = returnTypeNode.typeArguments;
  if (!ts.isTypeQueryNode(argument)) {
    return false;
  }

  const queryName = getEntityNameText(argument.exprName);
  return queryName === "setTimeout" || queryName === "setInterval";
};

const resolveTypeUseContext = (node) => {
  let current = node;
  while (ts.isTypeNode(current.parent)) {
    current = current.parent;
  }

  const container = current.parent;
  if (!container) {
    return null;
  }

  if (ts.isVariableDeclaration(container) && container.type === current) {
    return {
      container,
      symbol: getBindingNameText(container.name),
    };
  }

  if (ts.isParameter(container) && container.type === current) {
    return {
      container,
      symbol: getBindingNameText(container.name),
    };
  }

  if ((ts.isPropertyDeclaration(container) || ts.isPropertySignature(container)) && container.type === current) {
    return {
      container,
      symbol: getPropertyNameText(container.name),
    };
  }

  if (
    (ts.isFunctionDeclaration(container) ||
      ts.isFunctionExpression(container) ||
      ts.isArrowFunction(container) ||
      ts.isMethodDeclaration(container) ||
      ts.isMethodSignature(container)) &&
    container.type === current
  ) {
    return {
      container,
      symbol: getDeclarationNameText(container) ?? null,
    };
  }

  return null;
};

const isGenericBoundary = (node) => {
  let current = node;
  while (current && !ts.isSourceFile(current)) {
    if ("typeParameters" in current && Array.isArray(current.typeParameters) && current.typeParameters.length > 0) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

const isAnyTypeNode = (node) => node.kind === ts.SyntaxKind.AnyKeyword;

const isUnknownTypeNode = (node) => node.kind === ts.SyntaxKind.UnknownKeyword;

const isAnyOrUnknownTypeNode = (node) => isAnyTypeNode(node) || isUnknownTypeNode(node);

const isAnyOrUnknownType = (type) => (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;

const renderTypeNode = (node) => {
  if (isAnyTypeNode(node)) {
    return "`any`";
  }
  if (isUnknownTypeNode(node)) {
    return "`unknown`";
  }
  return `\`${node.getText()}\``;
};

const hasExportModifier = (node) =>
  node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;

const getNearestNamedSymbol = (node) => {
  let current = node;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isVariableDeclaration(current)) {
      return getBindingNameText(current.name);
    }
    if (ts.isParameter(current)) {
      return getBindingNameText(current.name);
    }
    if (ts.isTypeAliasDeclaration(current)) {
      return current.name.text;
    }
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isMethodSignature(current) ||
      ts.isPropertyDeclaration(current) ||
      ts.isPropertySignature(current)
    ) {
      return getDeclarationNameText(current) ?? null;
    }
    current = current.parent;
  }
  return null;
};

const getDeclarationNameText = (node) => {
  if (!("name" in node) || !node.name) {
    return null;
  }
  return getPropertyNameText(node.name);
};

const getPropertyNameText = (name) => {
  if (!name) {
    return null;
  }

  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  if (ts.isComputedPropertyName(name)) {
    return name.expression.getText();
  }

  return name.getText();
};

const getBindingNameText = (name) => {
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  return name.getText();
};

const getEntityNameText = (name) => {
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  return `${getEntityNameText(name.left)}.${name.right.text}`;
};

const isIdentifierNamed = (name, expected) => ts.isIdentifier(name) && name.text === expected;

const getEvidenceLine = (sourceFile, position) => {
  const lineStarts = sourceFile.getLineStarts();
  const { line } = sourceFile.getLineAndCharacterOfPosition(position);
  const lineStart = lineStarts[line];
  const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] : sourceFile.text.length;
  const text = sourceFile.text.slice(lineStart, lineEnd).trim().replace(/\s+/g, " ");
  return text.length <= 160 ? text : `${text.slice(0, 157)}...`;
};

const isWithinDir = (fileName, directory) => {
  const relative = path.relative(directory, fileName);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const toPosix = (value) => value.split(path.sep).join("/");

const formatDiagnostic = (diagnostic) => {
  const host = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  };
  return ts.formatDiagnostic(diagnostic, host).trim();
};

main().catch((error) => {
  const prefix = error instanceof UsageError ? "Usage error" : "Error";
  process.stderr.write(`${prefix}: ${error.message}\n`);
  if (error instanceof UsageError) {
    process.stderr.write(HELP_TEXT);
  }
  process.exitCode = 1;
});
