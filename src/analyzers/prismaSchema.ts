import fs from "node:fs";
import path from "node:path";
import type { Edge, Node } from "../model.js";

type PrismaColumn = {
  name: string;
  type: string;
  isId: boolean;
  isRequired: boolean;
  isUnique: boolean;
  default?: string;
  map?: string;
};

type PrismaModel = {
  name: string;
  columns: PrismaColumn[];
  relations: PrismaRelation[];
};

type PrismaRelation = {
  field: string;
  relatedModel: string;
  foreignKey?: string;
  isList: boolean;
};

const MODEL_BLOCK_PATTERN = /^model\s+(\w+)\s*\{/;
const ENUM_BLOCK_PATTERN = /^enum\s+(\w+)\s*\{/;
const SCALAR_TYPES = new Set([
  "String",
  "Int",
  "Float",
  "Boolean",
  "DateTime",
  "Json",
  "Bytes",
  "Decimal",
  "BigInt",
]);

export async function analyzePrismaSchema(
  projectRoot: string,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const schemaPath = path.join(projectRoot, "prisma", "schema.prisma");

  if (!fs.existsSync(schemaPath)) {
    return { nodes: [], edges: [] };
  }

  let content: string;
  try {
    content = fs.readFileSync(schemaPath, "utf8");
  } catch {
    return { nodes: [], edges: [] };
  }

  const models = parseModels(content);
  const enumNames = parseEnumNames(content);
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const edgeKeys = new Set<string>();

  // Build a map from lowercase model name to the camelCase form used by Prisma client
  const modelIdMap = new Map<string, string>();
  for (const model of models) {
    const camelCase = model.name.charAt(0).toLowerCase() + model.name.slice(1);
    modelIdMap.set(model.name, camelCase);
  }

  for (const model of models) {
    const camelName = modelIdMap.get(model.name) ?? model.name;
    const nodeId = `db:${camelName}`;
    nodes.push({
      id: nodeId,
      type: "db",
      label: model.name,
      meta: {
        filePath: "prisma/schema.prisma",
        model: model.name,
        columns: model.columns,
      },
    });

    for (const relation of model.relations) {
      if (relation.isList) {
        // Skip list relations — the "belongs-to" side will create the edge
        continue;
      }

      const fromId = nodeId;
      const relatedCamelName = modelIdMap.get(relation.relatedModel) ?? relation.relatedModel;
      const toId = `db:${relatedCamelName}`;
      const edgeKey = `${fromId}::${toId}::db-relation`;
      if (edgeKeys.has(edgeKey)) {
        continue;
      }

      edgeKeys.add(edgeKey);
      edges.push({
        from: fromId,
        to: toId,
        kind: "db-relation",
        meta: {
          field: relation.foreignKey ?? relation.field,
          foreignKey: "id",
        },
      });
    }
  }

  return {
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to),
    ),
  };
}

function parseEnumNames(content: string): Set<string> {
  const names = new Set<string>();
  const lines = content.split("\n");

  for (const line of lines) {
    const match = ENUM_BLOCK_PATTERN.exec(line.trim());
    if (match) {
      names.add(match[1]);
    }
  }

  return names;
}

function parseModels(content: string): PrismaModel[] {
  const models: PrismaModel[] = [];
  const lines = content.split("\n");
  const modelNames = new Set<string>();
  const enumNames = parseEnumNames(content);

  // First pass: collect all model names
  for (const line of lines) {
    const match = MODEL_BLOCK_PATTERN.exec(line.trim());
    if (match) {
      modelNames.add(match[1]);
    }
  }

  let currentModel: PrismaModel | null = null;
  let braceDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!currentModel) {
      const match = MODEL_BLOCK_PATTERN.exec(trimmed);
      if (match) {
        currentModel = { name: match[1], columns: [], relations: [] };
        braceDepth = 1;
      }
      continue;
    }

    // Track brace depth
    for (const ch of trimmed) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
    }

    if (braceDepth <= 0) {
      models.push(currentModel);
      currentModel = null;
      continue;
    }

    // Skip comments, empty lines, and @@-level attributes
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) {
      continue;
    }

    const field = parseField(trimmed, modelNames, enumNames);
    if (!field) {
      continue;
    }

    if (field.kind === "relation") {
      currentModel.relations.push(field.relation);
    } else {
      currentModel.columns.push(field.column);
    }
  }

  if (currentModel) {
    models.push(currentModel);
  }

  return models;
}

function parseField(
  line: string,
  modelNames: Set<string>,
  enumNames: Set<string>,
):
  | { kind: "column"; column: PrismaColumn }
  | { kind: "relation"; relation: PrismaRelation }
  | null {
  // Tokenize: split on whitespace but respect parentheses content
  const tokens = tokenizeLine(line);
  if (tokens.length < 2) {
    return null;
  }

  const fieldName = tokens[0];
  let rawType = tokens[1];

  // Skip if field name starts with @ (attribute line)
  if (fieldName.startsWith("@")) {
    return null;
  }

  const isList = rawType.endsWith("[]");
  const isOptional = rawType.endsWith("?");
  if (isList) {
    rawType = rawType.slice(0, -2);
  } else if (isOptional) {
    rawType = rawType.slice(0, -1);
  }

  const isRequired = !isOptional && !isList;

  // Check if it's a relation field (type references another model)
  if (modelNames.has(rawType)) {
    const relation: PrismaRelation = {
      field: fieldName,
      relatedModel: rawType,
      isList,
    };

    // Extract @relation fields/references
    const relationAttr = extractAttribute(tokens, "@relation");
    if (relationAttr) {
      const fields = extractArrayParam(relationAttr, "fields");
      const references = extractArrayParam(relationAttr, "references");
      if (fields && fields.length > 0) {
        relation.foreignKey = fields[0];
      }
      if (!relation.foreignKey && references && references.length > 0) {
        // fallback
      }
    }

    return { kind: "relation", relation };
  }

  // It's a column
  const column: PrismaColumn = {
    name: fieldName,
    type: rawType,
    isId: false,
    isRequired,
    isUnique: false,
  };

  const restTokens = tokens.slice(2);
  const restLine = restTokens.join(" ");

  if (restLine.includes("@id")) {
    column.isId = true;
  }
  if (restLine.includes("@unique")) {
    column.isUnique = true;
  }

  const defaultMatch = /@default\(([^)]*)\)/.exec(restLine);
  if (defaultMatch) {
    column.default = defaultMatch[1];
  }

  const mapMatch = /@map\("([^"]*)"\)/.exec(restLine);
  if (mapMatch) {
    column.map = mapMatch[1];
  }

  return { kind: "column", column };
}

function tokenizeLine(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let parenDepth = 0;
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inString) {
      current += ch;
      if (ch === stringChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }

    if (ch === "(") {
      parenDepth++;
      current += ch;
      continue;
    }

    if (ch === ")") {
      parenDepth--;
      current += ch;
      continue;
    }

    if (/\s/.test(ch) && parenDepth === 0) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function extractAttribute(tokens: string[], attrName: string): string | null {
  for (const token of tokens) {
    if (token.startsWith(attrName + "(")) {
      return token;
    }
    if (token === attrName) {
      return token;
    }
  }
  return null;
}

function extractArrayParam(attrString: string, paramName: string): string[] | null {
  const pattern = new RegExp(`${paramName}:\\s*\\[([^\\]]*)]`);
  const match = pattern.exec(attrString);
  if (!match) {
    return null;
  }

  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
