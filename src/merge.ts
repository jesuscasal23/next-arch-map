import type { Edge, Graph, Node } from "./model.js";
import { buildEdgeKey, mergeEdge, mergeNode } from "./utils.js";

export function mergeGraphs(graphs: Graph[]): Graph {
  return graphs.reduce<Graph>((accumulator, graph) => mergePartial(accumulator, graph), {
    nodes: [],
    edges: [],
  });
}

export function mergePartial(base: Graph, additions: { nodes: Node[]; edges: Edge[] }): Graph {
  const nodesById = new Map<string, Node>();
  const edgesByKey = new Map<string, Edge>();

  for (const node of base.nodes) {
    nodesById.set(node.id, node);
  }

  for (const node of additions.nodes) {
    const existingNode = nodesById.get(node.id);
    nodesById.set(node.id, existingNode ? mergeNode(existingNode, node) : node);
  }

  for (const edge of base.edges) {
    edgesByKey.set(buildEdgeKey(edge.from, edge.to, edge.kind), edge);
  }

  for (const edge of additions.edges) {
    const edgeKey = buildEdgeKey(edge.from, edge.to, edge.kind);
    const existingEdge = edgesByKey.get(edgeKey);
    edgesByKey.set(edgeKey, existingEdge ? mergeEdge(existingEdge, edge) : edge);
  }

  return {
    nodes: [...nodesById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edgesByKey.values()].sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.from.localeCompare(right.from) ||
        left.to.localeCompare(right.to),
    ),
  };
}
