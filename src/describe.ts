import fs from "node:fs";
import path from "node:path";
import type { Graph, Node } from "./model.js";
import { ensureDirectory, readJsonFile } from "./utils.js";

export type DescribeOptions = {
  graphPath: string;
  outPath: string;
  onlyMissing: boolean;
};

function needsDescription(node: Node, onlyMissing: boolean): boolean {
  if (!onlyMissing) return true;
  return !node.meta?.description;
}

function readSourceSafe(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8");
    }
  } catch {
    // ignore
  }
  return null;
}

export function generateDescribeContext(options: DescribeOptions): {
  contextPath: string;
  nodeCount: number;
} {
  const graph = readJsonFile<Graph>(options.graphPath);

  const nodes = graph.nodes.filter((node) =>
    needsDescription(node, options.onlyMissing),
  );

  const lines: string[] = [
    "# Describe Architecture Graph Nodes",
    "",
    `Update the node descriptions in \`${options.graphPath}\`.`,
    "",
    "For **every** node listed below, read the source code and add two fields to its `meta` object:",
    "",
    "- `meta.description` — A single sentence (under 80 characters). Displayed inside the node box in the viewer.",
    "- `meta.descriptionLong` — 2-3 sentences with more context. Shown in the details panel when clicking the node.",
    "",
    "## Style guide",
    "",
    "- Present tense, third person (\"Displays...\", \"Handles...\", \"Stores...\").",
    "- Be specific — prefer \"Displays paginated user list with search\" over \"Shows users\".",
    "- Don't repeat the node label — add information beyond what the name already tells you.",
    "",
    `## Nodes (${nodes.length})`,
    "",
  ];

  for (const node of nodes) {
    const filePath = node.meta?.filePath ? String(node.meta.filePath) : null;
    const source = filePath ? readSourceSafe(filePath) : null;

    lines.push(`### ${node.id}`);
    lines.push("");
    lines.push(`- **Type:** ${node.type}`);
    lines.push(`- **Label:** ${node.label}`);
    if (filePath) {
      lines.push(`- **File:** ${filePath}`);
    }

    if (node.meta?.description) {
      lines.push(
        `- **Current description:** ${String(node.meta.description)}`,
      );
    }

    if (source) {
      lines.push("");
      lines.push("```typescript");
      lines.push(source.trimEnd());
      lines.push("```");
    }

    lines.push("");
  }

  ensureDirectory(path.dirname(options.outPath));
  fs.writeFileSync(options.outPath, lines.join("\n"), "utf8");

  return { contextPath: options.outPath, nodeCount: nodes.length };
}
