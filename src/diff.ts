import type { Edge, Graph, Node } from "./model.js";
import { buildEdgeKey } from "./utils.js";

export type DiffStatus = "added" | "removed" | "modified" | "unchanged";

export type NodeDiff = {
  node: Node;
  status: DiffStatus;
};

export type EdgeDiff = {
  edge: Edge;
  status: DiffStatus;
};

export type GraphDiff = {
  nodes: NodeDiff[];
  edges: EdgeDiff[];
};

function nodeEqual(a: Node, b: Node): boolean {
  return a.type === b.type && a.label === b.label && JSON.stringify(a.meta) === JSON.stringify(b.meta);
}

function edgeEqual(a: Edge, b: Edge): boolean {
  return JSON.stringify(a.meta) === JSON.stringify(b.meta);
}

export function diffGraphs(before: Graph, after: Graph): GraphDiff {
  const beforeNodes = new Map<string, Node>();
  const afterNodes = new Map<string, Node>();
  const beforeEdges = new Map<string, Edge>();
  const afterEdges = new Map<string, Edge>();

  for (const node of before.nodes) {
    beforeNodes.set(node.id, node);
  }

  for (const node of after.nodes) {
    afterNodes.set(node.id, node);
  }

  for (const edge of before.edges) {
    beforeEdges.set(buildEdgeKey(edge.from, edge.to, edge.kind), edge);
  }

  for (const edge of after.edges) {
    afterEdges.set(buildEdgeKey(edge.from, edge.to, edge.kind), edge);
  }

  const nodes: NodeDiff[] = [];
  const edges: EdgeDiff[] = [];

  const allNodeKeys = new Set<string>([...beforeNodes.keys(), ...afterNodes.keys()]);
  for (const key of allNodeKeys) {
    const beforeNode = beforeNodes.get(key);
    const afterNode = afterNodes.get(key);

    if (beforeNode && !afterNode) {
      nodes.push({ node: beforeNode, status: "removed" });
      continue;
    }

    if (!beforeNode && afterNode) {
      nodes.push({ node: afterNode, status: "added" });
      continue;
    }

    if (beforeNode && afterNode) {
      const status = nodeEqual(beforeNode, afterNode) ? "unchanged" : "modified";
      nodes.push({ node: afterNode, status });
    }
  }

  const allEdgeKeys = new Set<string>([...beforeEdges.keys(), ...afterEdges.keys()]);
  for (const key of allEdgeKeys) {
    const beforeEdge = beforeEdges.get(key);
    const afterEdge = afterEdges.get(key);

    if (beforeEdge && !afterEdge) {
      edges.push({ edge: beforeEdge, status: "removed" });
      continue;
    }

    if (!beforeEdge && afterEdge) {
      edges.push({ edge: afterEdge, status: "added" });
      continue;
    }

    if (beforeEdge && afterEdge) {
      const status = edgeEqual(beforeEdge, afterEdge) ? "unchanged" : "modified";
      edges.push({ edge: afterEdge, status });
    }
  }

  nodes.sort((left, right) => left.node.id.localeCompare(right.node.id));
  edges.sort((left, right) => {
    const leftKey = `${left.edge.kind}:${left.edge.from}:${left.edge.to}`;
    const rightKey = `${right.edge.kind}:${right.edge.from}:${right.edge.to}`;
    return leftKey.localeCompare(rightKey);
  });

  return { nodes, edges };
}
