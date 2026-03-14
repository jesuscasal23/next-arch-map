import path from "node:path";
import ts from "typescript";
import type { Edge, Graph, Node } from "../model.js";
import {
  buildEdgeKey,
  buildEndpointNode,
  buildPageNode,
  collectStringConstants,
  getExistingDirectories,
  getPageRouteFromFile,
  getSourceFile,
  getStringLiteralValue,
  isIgnoredSourceFile,
  isPageFile,
  resolveProjectRoot,
  walkDirectory,
} from "../utils.js";

type HttpCall = {
  endpoint: string;
  method?: string;
};

type AnalyzePagesToEndpointsOptions = {
  projectRoot: string;
  appDirs?: string[];
  extraScanDirs?: string[];
  httpClientIdentifiers?: string[];
  httpClientMethods?: string[];
};

const DEFAULT_APP_DIRS = ["app", "src/app"];
const DEFAULT_EXTRA_SCAN_DIRS = ["src/features", "src/services", "src/lib", "src/hooks"];
const DEFAULT_HTTP_CLIENT_IDENTIFIERS = ["fetch", "axios", "apiClient"];
const DEFAULT_HTTP_CLIENT_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

export async function analyzePagesToEndpoints(
  options: AnalyzePagesToEndpointsOptions
): Promise<Graph> {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const appDirs = getExistingDirectories(projectRoot, options.appDirs ?? DEFAULT_APP_DIRS);

  if (appDirs.length === 0) {
    throw new Error("Could not find an app/ or src/app/ directory.");
  }

  const extraScanDirs = getExistingDirectories(
    projectRoot,
    options.extraScanDirs ?? DEFAULT_EXTRA_SCAN_DIRS
  );
  const httpClientIdentifiers = new Set(
    (options.httpClientIdentifiers ?? DEFAULT_HTTP_CLIENT_IDENTIFIERS).map((value) =>
      value.trim()
    )
  );
  const httpClientMethods = new Set(
    (options.httpClientMethods ?? DEFAULT_HTTP_CLIENT_METHODS).map((value) => value.toLowerCase())
  );
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const sourceFileCache = new Map<string, ts.SourceFile>();

  for (const appDir of appDirs) {
    for (const filePath of walkDirectory(appDir)) {
      if (isIgnoredSourceFile(filePath)) {
        continue;
      }

      const route = getPageRouteFromFile(appDir, filePath);
      if (isPageFile(filePath)) {
        ensureNode(nodes, nodeIds, buildPageNode(route));
      }

      const sourceFile = getSourceFile(filePath, sourceFileCache);
      if (!sourceFile) {
        continue;
      }

      for (const call of collectHttpCalls(sourceFile, httpClientIdentifiers, httpClientMethods)) {
        const pageNode = ensureNode(nodes, nodeIds, buildPageNode(route));
        const endpointNode = ensureNode(
          nodes,
          nodeIds,
          buildEndpointNode(call.endpoint, call.method)
        );
        const edgeKey = buildEdgeKey(pageNode.id, endpointNode.id, "page-endpoint");

        if (edgeKeys.has(edgeKey)) {
          continue;
        }

        edgeKeys.add(edgeKey);
        edges.push({
          from: pageNode.id,
          to: endpointNode.id,
          kind: "page-endpoint",
          meta: call.method ? { method: call.method } : undefined,
        });
      }
    }
  }

  for (const scanDir of extraScanDirs) {
    for (const filePath of walkDirectory(scanDir)) {
      if (isIgnoredSourceFile(filePath)) {
        continue;
      }

      const sourceFile = getSourceFile(filePath, sourceFileCache);
      if (!sourceFile) {
        continue;
      }

      for (const call of collectHttpCalls(sourceFile, httpClientIdentifiers, httpClientMethods)) {
        ensureNode(nodes, nodeIds, buildEndpointNode(call.endpoint, call.method));
      }
    }
  }

  return {
    nodes: nodes.sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.from.localeCompare(right.from) ||
        left.to.localeCompare(right.to)
    ),
  };
}

function collectHttpCalls(
  sourceFile: ts.SourceFile,
  httpClientIdentifiers: Set<string>,
  httpClientMethods: Set<string>
): HttpCall[] {
  const calls: HttpCall[] = [];
  const constMap = collectStringConstants(sourceFile);

  const visitNode = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const httpCall = parseHttpCall(node, constMap, httpClientIdentifiers, httpClientMethods);
      if (httpCall) {
        calls.push(httpCall);
      }
    }

    ts.forEachChild(node, visitNode);
  };

  visitNode(sourceFile);
  return calls;
}

function parseHttpCall(
  node: ts.CallExpression,
  constMap: Map<string, string>,
  httpClientIdentifiers: Set<string>,
  httpClientMethods: Set<string>
): HttpCall | null {
  const endpoint = getEndpointArgument(node.arguments[0], constMap);
  if (!endpoint) {
    return null;
  }

  if (ts.isIdentifier(node.expression) && httpClientIdentifiers.has(node.expression.text)) {
    return {
      endpoint,
      method: "GET",
    };
  }

  if (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    httpClientIdentifiers.has(node.expression.expression.text) &&
    httpClientMethods.has(node.expression.name.text.toLowerCase())
  ) {
    return {
      endpoint,
      method: node.expression.name.text.toUpperCase(),
    };
  }

  return null;
}

function getEndpointArgument(
  expression: ts.Expression | undefined,
  constMap: Map<string, string>
): string | null {
  if (!expression) {
    return null;
  }

  if (ts.isIdentifier(expression)) {
    return constMap.get(expression.text) ?? null;
  }

  return getStringLiteralValue(expression);
}

function ensureNode(nodes: Node[], nodeIds: Set<string>, node: Node): Node {
  if (nodeIds.has(node.id)) {
    return nodes.find((entry) => entry.id === node.id) ?? node;
  }

  nodeIds.add(node.id);
  nodes.push(node);
  return node;
}
