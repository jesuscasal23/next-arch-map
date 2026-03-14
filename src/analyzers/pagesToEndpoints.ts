import path from "node:path";
import ts from "typescript";
import type { Edge, Graph, Node } from "../model.js";
import {
  buildActionNode,
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
  mergeNode,
  resolveProjectRoot,
  walkDirectory,
} from "../utils.js";

type HttpCall = {
  endpoint: string;
  method?: string;
  node: ts.CallExpression;
};

type ActionContext = {
  id: string;
  meta?: Record<string, unknown>;
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
  const callIndexByRoute = new Map<string, number>();
  const actionIdCountByRoute = new Map<string, Map<string, number>>();

  for (const appDir of appDirs) {
    for (const filePath of walkDirectory(appDir)) {
      if (isIgnoredSourceFile(filePath)) {
        continue;
      }

      const route = getPageRouteFromFile(appDir, filePath);
      if (isPageFile(filePath)) {
        ensureNode(nodes, nodeIds, buildPageNode(route, filePath));
      }

      const sourceFile = getSourceFile(filePath, sourceFileCache);
      if (!sourceFile) {
        continue;
      }

      for (const call of collectHttpCalls(sourceFile, httpClientIdentifiers, httpClientMethods)) {
        const nextCallIndex = (callIndexByRoute.get(route) ?? 0) + 1;
        callIndexByRoute.set(route, nextCallIndex);
        const actionContext = inferActionContext(call.node, sourceFile, nextCallIndex);
        const actionId = allocateActionId(
          route,
          actionContext.id,
          actionIdCountByRoute
        );
        const pageNode = ensureNode(nodes, nodeIds, buildPageNode(route, filePath));
        const actionNode = ensureNode(
          nodes,
          nodeIds,
          buildActionNode(route, actionId, filePath, actionContext.meta)
        );
        const endpointNode = ensureNode(
          nodes,
          nodeIds,
          buildEndpointNode(call.endpoint, filePath, call.method)
        );

        const pageActionKey = buildEdgeKey(pageNode.id, actionNode.id, "page-action");
        if (!edgeKeys.has(pageActionKey)) {
          edgeKeys.add(pageActionKey);
          edges.push({
            from: pageNode.id,
            to: actionNode.id,
            kind: "page-action",
          });
        }

        const actionEndpointKey = buildEdgeKey(
          actionNode.id,
          endpointNode.id,
          "action-endpoint"
        );
        if (!edgeKeys.has(actionEndpointKey)) {
          edgeKeys.add(actionEndpointKey);
          edges.push({
            from: actionNode.id,
            to: endpointNode.id,
            kind: "action-endpoint",
            meta: call.method ? { method: call.method } : undefined,
          });
        }

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
        ensureNode(nodes, nodeIds, buildEndpointNode(call.endpoint, filePath, call.method));
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
        calls.push({
          endpoint: httpCall.endpoint,
          method: httpCall.method,
          node,
        });
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
): Omit<HttpCall, "node"> | null {
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

function inferActionContext(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  callIndex: number
): ActionContext {
  const fallbackId = `call-${callIndex}`;
  const meta: Record<string, unknown> = {};
  let handlerName: string | undefined;
  let componentName: string | undefined;
  let inlineEventName: string | undefined;
  let inlineElementName: string | undefined;

  let current: ts.Node | undefined = call;
  while (current && current !== sourceFile) {
    if (!inlineEventName && ts.isJsxAttribute(current) && ts.isIdentifier(current.name)) {
      inlineEventName = current.name.text;
      inlineElementName = getJsxElementName(current);
    }

    if (!handlerName && isFunctionLikeNode(current)) {
      handlerName = getFunctionLikeName(current);
    }

    if (isTopLevelNamedFunctionLike(current, sourceFile)) {
      componentName = getFunctionLikeName(current) ?? componentName;
    }

    current = current.parent;
  }

  if (componentName) {
    meta.componentName = componentName;
  }

  if (handlerName === componentName && !inlineEventName) {
    handlerName = undefined;
  }

  if (handlerName) {
    meta.handlerName = handlerName;
  }

  const eventBinding =
    inlineEventName || inlineElementName
      ? {
          eventName: inlineEventName,
          elementName: inlineElementName,
        }
      : handlerName
        ? findJsxBindingForHandler(sourceFile, handlerName)
        : undefined;

  if (eventBinding?.eventName) {
    meta.eventName = eventBinding.eventName;
  }

  if (eventBinding?.elementName) {
    meta.elementName = eventBinding.elementName;
  }

  const callTarget = getCallTargetName(call);
  if (callTarget) {
    meta.callTarget = callTarget;
  }

  const actionId = buildActionContextId({
    componentName,
    handlerName,
    eventName: eventBinding?.eventName,
    elementName: eventBinding?.elementName,
    callTarget,
  });

  return {
    id: actionId ?? fallbackId,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
  };
}

function allocateActionId(
  route: string,
  baseActionId: string,
  countsByRoute: Map<string, Map<string, number>>
): string {
  const normalizedActionId = normalizeActionId(baseActionId);
  const routeCounts = countsByRoute.get(route) ?? new Map<string, number>();
  const nextCount = (routeCounts.get(normalizedActionId) ?? 0) + 1;

  routeCounts.set(normalizedActionId, nextCount);
  countsByRoute.set(route, routeCounts);

  return nextCount === 1 ? normalizedActionId : `${normalizedActionId}.${nextCount}`;
}

function buildActionContextId(parts: {
  componentName?: string;
  handlerName?: string;
  eventName?: string;
  elementName?: string;
  callTarget?: string;
}): string | null {
  if (parts.elementName && parts.eventName) {
    return [parts.elementName, parts.eventName].map(normalizeActionId).join(".");
  }

  if (parts.componentName && parts.handlerName) {
    return [parts.componentName, parts.handlerName].map(normalizeActionId).join(".");
  }

  if (parts.handlerName && parts.eventName) {
    return [parts.handlerName, parts.eventName].map(normalizeActionId).join(".");
  }

  if (parts.handlerName) {
    return normalizeActionId(parts.handlerName);
  }

  if (parts.componentName && parts.callTarget) {
    return [parts.componentName, parts.callTarget].map(normalizeActionId).join(".");
  }

  if (parts.callTarget) {
    return normalizeActionId(parts.callTarget);
  }

  return null;
}

function isFunctionLikeNode(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node)
  );
}

function isTopLevelNamedFunctionLike(
  node: ts.Node,
  sourceFile: ts.SourceFile
): node is ts.FunctionLikeDeclaration {
  if (!isFunctionLikeNode(node)) {
    return false;
  }

  if (!getFunctionLikeName(node)) {
    return false;
  }

  if (ts.isFunctionDeclaration(node)) {
    return node.parent === sourceFile;
  }

  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return ts.isVariableDeclaration(node.parent) && node.parent.parent.parent.parent === sourceFile;
  }

  return false;
}

function getFunctionLikeName(node: ts.FunctionLikeDeclaration): string | undefined {
  if (
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) &&
    node.name &&
    ts.isIdentifier(node.name)
  ) {
    return node.name.text;
  }

  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) {
    return ts.isIdentifier(node.parent.name) ? node.parent.name.text : undefined;
  }

  return undefined;
}

function findJsxBindingForHandler(
  sourceFile: ts.SourceFile,
  handlerName: string
): { eventName?: string; elementName?: string } | undefined {
  let match: { eventName?: string; elementName?: string } | undefined;

  const visitNode = (node: ts.Node): void => {
    if (match) {
      return;
    }

    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === handlerName
    ) {
      match = {
        eventName: node.name.text,
        elementName: getJsxElementName(node),
      };
      return;
    }

    ts.forEachChild(node, visitNode);
  };

  visitNode(sourceFile);
  return match;
}

function getJsxElementName(attribute: ts.JsxAttribute): string | undefined {
  const jsxOwner = attribute.parent.parent;

  if (!jsxOwner) {
    return undefined;
  }

  if (ts.isJsxOpeningElement(jsxOwner) || ts.isJsxSelfClosingElement(jsxOwner)) {
    return jsxOwner.tagName.getText();
  }

  return undefined;
}

function getCallTargetName(call: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(call.expression)) {
    return call.expression.text;
  }

  if (ts.isPropertyAccessExpression(call.expression)) {
    return call.expression.getText();
  }

  return undefined;
}

function normalizeActionId(value: string): string {
  return value.replace(/[:#/]/g, ".").replace(/\s+/g, "");
}
