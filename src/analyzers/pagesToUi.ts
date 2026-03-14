import path from "node:path";
import ts from "typescript";
import type { Edge, Node } from "../model.js";
import {
  buildEdgeKey,
  buildPageNode,
  buildUiNode,
  getExistingDirectories,
  getPageRouteFromFile,
  getSourceFile,
  isPageFile,
  resolveLocalModulePath,
  resolveProjectRoot,
  walkDirectory,
} from "../utils.js";

type AnalyzePagesToUiOptions = {
  projectRoot: string;
  appDirs?: string[];
  uiImportPathGlobs?: string[];
};

const DEFAULT_APP_DIRS = ["app", "src/app"];
const DEFAULT_UI_IMPORT_PATH_GLOBS = [
  "src/components/**",
  "src/features/**/components/**",
  "src/app/**/components/**",
  "app/**/components/**",
];

export async function analyzePagesToUi(
  options: AnalyzePagesToUiOptions
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const appDirs = getExistingDirectories(projectRoot, options.appDirs ?? DEFAULT_APP_DIRS);

  if (appDirs.length === 0) {
    throw new Error("Could not find an app/ or src/app/ directory.");
  }

  const uiPathMatchers = (options.uiImportPathGlobs ?? DEFAULT_UI_IMPORT_PATH_GLOBS).map(globToRegExp);
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();

  for (const appDir of appDirs) {
    for (const filePath of walkDirectory(appDir)) {
      if (!isPageFile(filePath)) {
        continue;
      }

      const route = getPageRouteFromFile(appDir, filePath);
      const pageNode = ensureNode(nodes, nodeIds, buildPageNode(route));
      const componentNames = collectUiComponentNames(filePath, projectRoot, uiPathMatchers);

      for (const componentName of componentNames) {
        const uiNode = ensureNode(nodes, nodeIds, buildUiNode(componentName));
        const edgeKey = buildEdgeKey(pageNode.id, uiNode.id, "page-ui");

        if (edgeKeys.has(edgeKey)) {
          continue;
        }

        edgeKeys.add(edgeKey);
        edges.push({
          from: pageNode.id,
          to: uiNode.id,
          kind: "page-ui",
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

function collectUiComponentNames(
  pageFilePath: string,
  projectRoot: string,
  uiPathMatchers: RegExp[]
): string[] {
  const sourceFile = getSourceFile(pageFilePath);
  if (!sourceFile) {
    return [];
  }

  const componentNames = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const importSource = statement.moduleSpecifier.text;
    const resolvedImportPath = resolveLocalModulePath(pageFilePath, importSource, projectRoot);
    if (!isUiLikeImport(importSource, resolvedImportPath, projectRoot, uiPathMatchers)) {
      continue;
    }

    const importClause = statement.importClause;
    if (!importClause || importClause.isTypeOnly) {
      continue;
    }

    if (importClause.name && isUiComponentName(importClause.name.text)) {
      componentNames.add(importClause.name.text);
    }

    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        if (!element.isTypeOnly && isUiComponentName(element.name.text)) {
          componentNames.add(element.name.text);
        }
      }
    }
  }

  return [...componentNames].sort((left, right) => left.localeCompare(right));
}

function isUiLikeImport(
  importSource: string,
  resolvedImportPath: string | null,
  projectRoot: string,
  uiPathMatchers: RegExp[]
): boolean {
  if (
    importSource.startsWith("./components") ||
    importSource.startsWith("../components") ||
    importSource.startsWith("@/components/")
  ) {
    return true;
  }

  if (!resolvedImportPath) {
    return false;
  }

  const relativePath = path.relative(projectRoot, resolvedImportPath).replace(/\\/g, "/");
  return uiPathMatchers.some((matcher) => matcher.test(relativePath));
}

function isUiComponentName(identifierName: string): boolean {
  return /^[A-Z]/.test(identifierName);
}

function globToRegExp(glob: string): RegExp {
  let pattern = "^";

  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    const nextCharacter = glob[index + 1];

    if (character === "*" && nextCharacter === "*") {
      pattern += ".*";
      index += 1;
      continue;
    }

    if (character === "*") {
      pattern += "[^/]*";
      continue;
    }

    pattern += /[.+^${}()|[\]\\]/.test(character) ? `\\${character}` : character;
  }

  pattern += "$";
  return new RegExp(pattern);
}

function ensureNode(nodes: Node[], nodeIds: Set<string>, node: Node): Node {
  if (nodeIds.has(node.id)) {
    return nodes.find((entry) => entry.id === node.id) ?? node;
  }

  nodeIds.add(node.id);
  nodes.push(node);
  return node;
}
