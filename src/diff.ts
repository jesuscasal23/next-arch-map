import type { Edge, Graph, Node } from "./model.js";

export type DiffStatus = "added" | "removed" | "unchanged";

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

function buildNodeKey(node: Node): string {
  return node.id;
}

function buildEdgeKey(edge: Edge): string {
  return `${edge.from}::${edge.to}::${edge.kind}`;
}

export function diffGraphs(before: Graph, after: Graph): GraphDiff {
  const beforeNodes = new Map<string, Node>();
  const afterNodes = new Map<string, Node>();
  const beforeEdges = new Map<string, Edge>();
  const afterEdges = new Map<string, Edge>();

  for (const node of before.nodes) {
    beforeNodes.set(buildNodeKey(node), node);
  }

  for (const node of after.nodes) {
    afterNodes.set(buildNodeKey(node), node);
  }

  for (const edge of before.edges) {
    beforeEdges.set(buildEdgeKey(edge), edge);
  }

  for (const edge of after.edges) {
    afterEdges.set(buildEdgeKey(edge), edge);
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

    if (afterNode) {
      nodes.push({ node: afterNode, status: "unchanged" });
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

    if (afterEdge) {
      edges.push({ edge: afterEdge, status: "unchanged" });
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
