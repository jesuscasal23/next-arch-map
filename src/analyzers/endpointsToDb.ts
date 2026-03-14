import path from "node:path";
import ts from "typescript";
import type { Edge, Node } from "../model.js";
import {
  buildDbNode,
  buildEdgeKey,
  buildEndpointNode,
  getEndpointRouteFromFile,
  getExistingDirectories,
  getSourceFile,
  isIgnoredSourceFile,
  isRouteHandlerFile,
  resolveLocalModulePath,
  resolveProjectRoot,
  walkDirectory,
} from "../utils.js";

type AnalyzeEndpointsToDbOptions = {
  projectRoot: string;
  apiDirs?: string[];
  dbClientIdentifiers?: string[];
};

type ImportTarget = {
  filePath: string;
  exportName: string;
};

type ExportTarget =
  | {
      kind: "local";
      localName: string;
    }
  | {
      kind: "reexport";
      filePath: string;
      exportName: string;
    }
  | {
      kind: "node";
      node: ts.Node;
    };

type ModuleInfo = {
  localDeclarations: Map<string, ts.Node>;
  importsByLocalName: Map<string, ImportTarget>;
  exportsByName: Map<string, ExportTarget>;
};

type ResolvedDeclaration = {
  filePath: string;
  key: string;
  node: ts.Node;
};

type AnalysisState = {
  projectRoot: string;
  moduleCache: Map<string, ModuleInfo>;
  sourceFileCache: Map<string, ts.SourceFile>;
  visitedDeclarationKeys: Set<string>;
  dbUsageByModel: Map<string, string | undefined>;
};

const DEFAULT_API_DIRS = ["app", "src/app", "app/api", "src/app/api", "src/server", "src/api"];
const DEFAULT_DB_CLIENT_IDENTIFIERS = ["prisma"];
const ROUTE_METHOD_EXPORTS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export async function analyzeEndpointsToDb(
  options: AnalyzeEndpointsToDbOptions
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const scanRoots = getExistingDirectories(projectRoot, options.apiDirs ?? DEFAULT_API_DIRS);
  const dbClientIdentifiers = new Set(options.dbClientIdentifiers ?? DEFAULT_DB_CLIENT_IDENTIFIERS);
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const sourceFileCache = new Map<string, ts.SourceFile>();
  const moduleCache = new Map<string, ModuleInfo>();
  const seenRouteFiles = new Set<string>();

  for (const scanRoot of scanRoots) {
    for (const filePath of walkDirectory(scanRoot)) {
      if (seenRouteFiles.has(filePath) || isIgnoredSourceFile(filePath) || !isRouteHandlerFile(filePath)) {
        continue;
      }

      seenRouteFiles.add(filePath);
      const endpointPath = getEndpointRouteFromFile(scanRoot, filePath);
      const dbUsageByModel = analyzeEndpoint(
        filePath,
        projectRoot,
        moduleCache,
        sourceFileCache,
        dbClientIdentifiers
      );

      if (dbUsageByModel.size === 0) {
        continue;
      }

      const endpointNode = ensureNode(nodes, nodeIds, buildEndpointNode(endpointPath));

      for (const [modelName, actionName] of dbUsageByModel) {
        const dbNode = ensureNode(nodes, nodeIds, buildDbNode(modelName));
        const edgeKey = buildEdgeKey(endpointNode.id, dbNode.id, "endpoint-db");

        if (edgeKeys.has(edgeKey)) {
          continue;
        }

        edgeKeys.add(edgeKey);
        edges.push({
          from: endpointNode.id,
          to: dbNode.id,
          kind: "endpoint-db",
          meta: actionName ? { action: actionName } : undefined,
        });
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

function analyzeEndpoint(
  routeFilePath: string,
  projectRoot: string,
  moduleCache: Map<string, ModuleInfo>,
  sourceFileCache: Map<string, ts.SourceFile>,
  dbClientIdentifiers: Set<string>
): Map<string, string | undefined> {
  const state: AnalysisState = {
    projectRoot,
    moduleCache,
    sourceFileCache,
    visitedDeclarationKeys: new Set<string>(),
    dbUsageByModel: new Map<string, string | undefined>(),
  };

  for (const methodName of ROUTE_METHOD_EXPORTS) {
    const resolvedDeclaration = resolveExportReference(routeFilePath, methodName, state);
    if (resolvedDeclaration) {
      analyzeDeclaration(resolvedDeclaration, state, new Set(dbClientIdentifiers));
    }
  }

  return state.dbUsageByModel;
}

function analyzeDeclaration(
  declaration: ResolvedDeclaration,
  state: AnalysisState,
  activeDbClients: Set<string>
): void {
  if (state.visitedDeclarationKeys.has(declaration.key)) {
    return;
  }

  state.visitedDeclarationKeys.add(declaration.key);
  visitNode(getAnalyzableNode(declaration.node), declaration.filePath, state, activeDbClients);
}

function visitNode(
  node: ts.Node,
  filePath: string,
  state: AnalysisState,
  activeDbClients: Set<string>
): void {
  if (ts.isCallExpression(node)) {
    const dbUsage = parseDbUsage(node, activeDbClients);
    if (dbUsage) {
      const existingAction = state.dbUsageByModel.get(dbUsage.modelName);
      if (!existingAction) {
        state.dbUsageByModel.set(dbUsage.modelName, dbUsage.actionName);
      }
    }

    const transactionCallback = getTransactionCallback(node, activeDbClients);
    if (transactionCallback) {
      visitNode(
        getFunctionBodyNode(transactionCallback.callback),
        filePath,
        state,
        new Set([...activeDbClients, transactionCallback.clientIdentifier])
      );
    }

    if (shouldResolveCall(node)) {
      const resolvedCallee = resolveIdentifierReference(node.expression.text, filePath, state);
      if (resolvedCallee) {
        analyzeDeclaration(resolvedCallee, state, activeDbClients);
      }
    }
  }

  ts.forEachChild(node, (child) => visitNode(child, filePath, state, activeDbClients));
}

function parseDbUsage(
  node: ts.CallExpression,
  activeDbClients: Set<string>
): { modelName: string; actionName?: string } | null {
  if (
    !ts.isPropertyAccessExpression(node.expression) ||
    !ts.isPropertyAccessExpression(node.expression.expression) ||
    !ts.isIdentifier(node.expression.expression.expression)
  ) {
    return null;
  }

  const clientIdentifier = node.expression.expression.expression.text;
  if (!activeDbClients.has(clientIdentifier)) {
    return null;
  }

  return {
    modelName: node.expression.expression.name.text,
    actionName: node.expression.name.text,
  };
}

function getTransactionCallback(
  node: ts.CallExpression,
  activeDbClients: Set<string>
):
  | {
      callback: ts.ArrowFunction | ts.FunctionExpression;
      clientIdentifier: string;
    }
  | null {
  if (
    !ts.isPropertyAccessExpression(node.expression) ||
    !ts.isIdentifier(node.expression.expression) ||
    !activeDbClients.has(node.expression.expression.text) ||
    node.expression.name.text !== "$transaction"
  ) {
    return null;
  }

  const callback = node.arguments.find(
    (argument): argument is ts.ArrowFunction | ts.FunctionExpression =>
      ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
  );
  const firstParameter = callback?.parameters[0];

  if (!callback || !firstParameter || !ts.isIdentifier(firstParameter.name)) {
    return null;
  }

  return {
    callback,
    clientIdentifier: firstParameter.name.text,
  };
}

function shouldResolveCall(
  node: ts.CallExpression
): node is ts.CallExpression & { expression: ts.Identifier } {
  return (
    ts.isIdentifier(node.expression) &&
    !node.arguments.some((argument) =>
      ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
    )
  );
}

function resolveIdentifierReference(
  identifierName: string,
  filePath: string,
  state: AnalysisState
): ResolvedDeclaration | null {
  const moduleInfo = getModuleInfo(filePath, state);
  const localDeclaration = moduleInfo.localDeclarations.get(identifierName);

  if (localDeclaration) {
    return {
      filePath,
      key: `${filePath}::local::${identifierName}`,
      node: localDeclaration,
    };
  }

  const importTarget = moduleInfo.importsByLocalName.get(identifierName);
  if (!importTarget) {
    return null;
  }

  return resolveExportReference(importTarget.filePath, importTarget.exportName, state);
}

function resolveExportReference(
  filePath: string,
  exportName: string,
  state: AnalysisState,
  seen = new Set<string>()
): ResolvedDeclaration | null {
  const seenKey = `${filePath}::${exportName}`;
  if (seen.has(seenKey)) {
    return null;
  }

  seen.add(seenKey);
  const moduleInfo = getModuleInfo(filePath, state);
  const exportTarget = moduleInfo.exportsByName.get(exportName);

  if (!exportTarget) {
    const fallbackDeclaration = moduleInfo.localDeclarations.get(exportName);
    if (!fallbackDeclaration) {
      return null;
    }

    return {
      filePath,
      key: `${filePath}::local::${exportName}`,
      node: fallbackDeclaration,
    };
  }

  if (exportTarget.kind === "local") {
    const localDeclaration = moduleInfo.localDeclarations.get(exportTarget.localName);
    if (!localDeclaration) {
      return null;
    }

    return {
      filePath,
      key: `${filePath}::local::${exportTarget.localName}`,
      node: localDeclaration,
    };
  }

  if (exportTarget.kind === "node") {
    return {
      filePath,
      key: `${filePath}::node::${exportName}`,
      node: exportTarget.node,
    };
  }

  return resolveExportReference(exportTarget.filePath, exportTarget.exportName, state, seen);
}

function getModuleInfo(filePath: string, state: AnalysisState): ModuleInfo {
  const cachedModuleInfo = state.moduleCache.get(filePath);
  if (cachedModuleInfo) {
    return cachedModuleInfo;
  }

  const sourceFile = getSourceFile(filePath, state.sourceFileCache);
  if (!sourceFile) {
    throw new Error(`Could not parse ${path.relative(state.projectRoot, filePath)}.`);
  }

  const localDeclarations = new Map<string, ts.Node>();
  const importsByLocalName = new Map<string, ImportTarget>();
  const exportsByName = new Map<string, ExportTarget>();

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      localDeclarations.set(statement.name.text, statement);

      if (hasExportModifier(statement)) {
        exportsByName.set(statement.name.text, {
          kind: "local",
          localName: statement.name.text,
        });
      }

      if (hasDefaultModifier(statement)) {
        exportsByName.set("default", {
          kind: "local",
          localName: statement.name.text,
        });
      }

      continue;
    }

    if (ts.isVariableStatement(statement)) {
      const exported = hasExportModifier(statement);

      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }

        localDeclarations.set(declaration.name.text, declaration);

        if (exported) {
          exportsByName.set(declaration.name.text, {
            kind: "local",
            localName: declaration.name.text,
          });
        }
      }

      continue;
    }

    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const resolvedImportPath = resolveLocalModulePath(
        filePath,
        statement.moduleSpecifier.text,
        state.projectRoot
      );
      if (!resolvedImportPath || !statement.importClause) {
        continue;
      }

      if (statement.importClause.name) {
        importsByLocalName.set(statement.importClause.name.text, {
          filePath: resolvedImportPath,
          exportName: "default",
        });
      }

      if (
        statement.importClause.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        for (const element of statement.importClause.namedBindings.elements) {
          importsByLocalName.set(element.name.text, {
            filePath: resolvedImportPath,
            exportName: element.propertyName?.text ?? element.name.text,
          });
        }
      }

      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const resolvedModulePath =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? resolveLocalModulePath(filePath, statement.moduleSpecifier.text, state.projectRoot)
          : null;

      for (const element of statement.exportClause.elements) {
        const exportName = element.name.text;
        if (resolvedModulePath) {
          exportsByName.set(exportName, {
            kind: "reexport",
            filePath: resolvedModulePath,
            exportName: element.propertyName?.text ?? element.name.text,
          });
          continue;
        }

        exportsByName.set(exportName, {
          kind: "local",
          localName: element.propertyName?.text ?? element.name.text,
        });
      }

      continue;
    }

    if (ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression)) {
        exportsByName.set("default", {
          kind: "local",
          localName: statement.expression.text,
        });
      } else {
        exportsByName.set("default", {
          kind: "node",
          node: statement.expression,
        });
      }
    }
  }

  const moduleInfo: ModuleInfo = {
    localDeclarations,
    importsByLocalName,
    exportsByName,
  };
  state.moduleCache.set(filePath, moduleInfo);
  return moduleInfo;
}

function getAnalyzableNode(node: ts.Node): ts.Node {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.body ?? node;
  }

  if (ts.isVariableDeclaration(node)) {
    return node.initializer ?? node;
  }

  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return getFunctionBodyNode(node);
  }

  return node;
}

function getFunctionBodyNode(node: ts.ArrowFunction | ts.FunctionExpression): ts.Node {
  return node.body;
}

function hasExportModifier(node: ts.HasModifiers): boolean {
  return ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasDefaultModifier(node: ts.HasModifiers): boolean {
  return ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

function ensureNode(nodes: Node[], nodeIds: Set<string>, node: Node): Node {
  if (nodeIds.has(node.id)) {
    return nodes.find((entry) => entry.id === node.id) ?? node;
  }

  nodeIds.add(node.id);
  nodes.push(node);
  return node;
}
