import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { Edge, Node } from "./model.js";

const ROUTE_GROUP_PATTERN = /^\(.*\)$/;
const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx)$/;
const PAGE_FILE_PATTERN = /^page\.(ts|tsx|js|jsx)$/;
const ROUTE_FILE_PATTERN = /^route\.(ts|tsx|js|jsx)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", ".next", "__tests__"]);

export function resolveProjectRoot(projectRoot: string): string {
  return path.resolve(projectRoot);
}

export function resolveProjectPath(projectRoot: string, targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(projectRoot, targetPath);
}

export function directoryExists(directoryPath: string): boolean {
  return fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory();
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

export function getExistingDirectories(projectRoot: string, candidateDirs: string[]): string[] {
  return candidateDirs
    .map((directoryPath) => resolveProjectPath(projectRoot, directoryPath))
    .filter(directoryExists);
}

export function walkDirectory(directoryPath: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDirectory(entryPath));
      continue;
    }

    if (SOURCE_FILE_PATTERN.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

export function isIgnoredSourceFile(filePath: string): boolean {
  return (
    !SOURCE_FILE_PATTERN.test(filePath) ||
    filePath.endsWith(".test.ts") ||
    filePath.endsWith(".test.tsx") ||
    filePath.endsWith(".test.js") ||
    filePath.endsWith(".test.jsx")
  );
}

export function isPageFile(filePath: string): boolean {
  return PAGE_FILE_PATTERN.test(path.basename(filePath));
}

export function isRouteHandlerFile(filePath: string): boolean {
  return ROUTE_FILE_PATTERN.test(path.basename(filePath));
}

export function getPageRouteFromFile(appDir: string, filePath: string): string {
  const segments = path.relative(appDir, filePath).split(path.sep).filter(Boolean);

  if (segments.length === 0) {
    return "/";
  }

  segments.pop();

  const routeSegments = segments
    .filter((segment) => !ROUTE_GROUP_PATTERN.test(segment))
    .map(decodeRouteSegment);

  return routeSegments.length === 0 ? "/" : `/${routeSegments.join("/")}`;
}

export function getEndpointRouteFromFile(scanRoot: string, filePath: string): string {
  const segments = path.relative(scanRoot, filePath).split(path.sep).filter(Boolean);
  const fileName = segments.pop() ?? "";
  const routeSegments = segments
    .filter((segment) => !ROUTE_GROUP_PATTERN.test(segment))
    .map(decodeRouteSegment);
  const prefixedSegments = [...getEndpointPrefixSegments(scanRoot), ...routeSegments].filter(
    Boolean,
  );

  if (!ROUTE_FILE_PATTERN.test(fileName)) {
    return prefixedSegments.length === 0 ? "/" : `/${prefixedSegments.join("/")}`;
  }

  if (prefixedSegments.length > 1 && prefixedSegments[0] === prefixedSegments[1]) {
    prefixedSegments.shift();
  }

  return prefixedSegments.length === 0 ? "/" : `/${prefixedSegments.join("/")}`;
}

function getEndpointPrefixSegments(scanRoot: string): string[] {
  const normalized = scanRoot.replace(/\\/g, "/");

  if (normalized.endsWith("/app/api") || normalized.endsWith("/src/app/api")) {
    return ["api"];
  }

  if (normalized.endsWith("/src/api") || path.basename(scanRoot) === "api") {
    return ["api"];
  }

  if (normalized.endsWith("/src/server") || path.basename(scanRoot) === "server") {
    return ["server"];
  }

  return [];
}

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function getScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (filePath.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }

  if (filePath.endsWith(".js")) {
    return ts.ScriptKind.JS;
  }

  return ts.ScriptKind.TS;
}

export function getSourceFile(
  filePath: string,
  sourceFileCache?: Map<string, ts.SourceFile>,
): ts.SourceFile | null {
  const cachedSourceFile = sourceFileCache?.get(filePath);
  if (cachedSourceFile) {
    return cachedSourceFile;
  }

  try {
    const sourceFile = ts.createSourceFile(
      filePath,
      fs.readFileSync(filePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      getScriptKind(filePath),
    );
    sourceFileCache?.set(filePath, sourceFile);
    return sourceFile;
  } catch {
    return null;
  }
}

export function resolveLocalModulePath(
  importerFilePath: string,
  specifier: string,
  projectRoot: string,
): string | null {
  let basePath: string | null = null;

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    basePath = path.resolve(path.dirname(importerFilePath), specifier);
  } else if (specifier.startsWith("@/")) {
    basePath = path.join(projectRoot, "src", specifier.slice(2));
  }

  if (!basePath) {
    return null;
  }

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.jsx"),
  ];

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function ensureDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true });
}

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function writeJsonFile(filePath: string, value: unknown): void {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function buildEdgeKey(from: string, to: string, kind: string): string {
  return `${from}::${to}::${kind}`;
}

export function ensureNode(nodes: Node[], nodeIds: Set<string>, node: Node): Node {
  if (nodeIds.has(node.id)) {
    const existingNodeIndex = nodes.findIndex((entry) => entry.id === node.id);
    if (existingNodeIndex === -1) {
      return node;
    }

    const mergedNode = mergeNode(nodes[existingNodeIndex], node);
    nodes[existingNodeIndex] = mergedNode;
    return mergedNode;
  }

  nodeIds.add(node.id);
  nodes.push(node);
  return node;
}

export function collectStringConstants(sourceFile: ts.SourceFile): Map<string, string> {
  const constMap = new Map<string, string>();

  const visitNode = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const stringValue = getStringLiteralValue(node.initializer);
      if (stringValue !== null) {
        constMap.set(node.name.text, stringValue);
      }
    }

    ts.forEachChild(node, visitNode);
  };

  visitNode(sourceFile);
  return constMap;
}

export function getStringLiteralValue(expression: ts.Expression): string | null {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }

  return null;
}

export function mergeMeta(
  baseMeta?: Record<string, any>,
  nextMeta?: Record<string, any>,
): Record<string, any> | undefined {
  if (!baseMeta) {
    return nextMeta;
  }

  if (!nextMeta) {
    return baseMeta;
  }

  return {
    ...baseMeta,
    ...nextMeta,
  };
}

export function mergeNode(existingNode: Node, nextNode: Node): Node {
  return {
    ...existingNode,
    ...nextNode,
    meta: mergeMeta(existingNode.meta, nextNode.meta),
  };
}

export function mergeEdge(existingEdge: Edge, nextEdge: Edge): Edge {
  return {
    ...existingEdge,
    ...nextEdge,
    meta: mergeMeta(existingEdge.meta, nextEdge.meta),
  };
}

export function buildPageNode(route: string, filePath: string) {
  return {
    id: `page:${route}`,
    type: "page" as const,
    label: route,
    meta: {
      filePath,
      route,
    },
  };
}

export function buildEndpointNode(endpoint: string, filePath: string) {
  return {
    id: `endpoint:${endpoint}`,
    type: "endpoint" as const,
    label: endpoint,
    meta: {
      filePath,
      route: endpoint,
    },
  };
}

export function buildHandlerNode(endpoint: string, filePath: string, method?: string) {
  const label = method ? `${endpoint}#${method}` : endpoint;

  return {
    id: method ? `handler:${endpoint}:${method}` : `handler:${endpoint}`,
    type: "handler" as const,
    label,
    meta: {
      filePath,
      route: endpoint,
      ...(method ? { method } : {}),
    },
  };
}

export function buildActionNode(
  pageRoute: string,
  actionId: string,
  filePath: string,
  extraMeta?: Record<string, unknown>,
) {
  const label = actionId;

  return {
    id: `action:${pageRoute}:${actionId}`,
    type: "action" as const,
    label,
    meta: {
      filePath,
      route: pageRoute,
      actionId,
      ...(extraMeta ?? {}),
    },
  };
}

export function buildDbNode(modelName: string, filePath: string) {
  return {
    id: `db:${modelName}`,
    type: "db" as const,
    label: modelName,
    meta: {
      filePath,
      model: modelName,
    },
  };
}

export function buildUiNode(componentName: string, filePath: string) {
  return {
    id: `ui:${componentName}`,
    type: "ui" as const,
    label: componentName,
    meta: {
      filePath,
      component: componentName,
    },
  };
}
