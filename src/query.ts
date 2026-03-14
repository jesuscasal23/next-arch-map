import type { Graph, Node } from "./model.js";

export function getPageNode(graph: Graph, route: string): Node | null {
  const id = `page:${route}`;
  return graph.nodes.find((node) => node.id === id) ?? null;
}

export function getDbNode(graph: Graph, modelName: string): Node | null {
  const id = `db:${modelName}`;
  return graph.nodes.find((node) => node.id === id) ?? null;
}

export function getEndpointsForPage(graph: Graph, route: string): Node[] {
  const pageNode = getPageNode(graph, route);
  if (!pageNode) {
    return [];
  }

  const endpointIds = new Set<string>();
  const actionIds = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.kind === "page-endpoint" && edge.from === pageNode.id) {
      endpointIds.add(edge.to);
    }

    if (edge.kind === "page-action" && edge.from === pageNode.id) {
      actionIds.add(edge.to);
    }
  }

  if (actionIds.size > 0) {
    for (const edge of graph.edges) {
      if (edge.kind === "action-endpoint" && actionIds.has(edge.from)) {
        endpointIds.add(edge.to);
      }
    }
  }

  return graph.nodes.filter((node) => endpointIds.has(node.id));
}

export function getDbModelsForPage(graph: Graph, route: string): Node[] {
  const endpoints = getEndpointsForPage(graph, route);
  if (endpoints.length === 0) {
    return [];
  }

  const endpointIds = new Set(endpoints.map((node) => node.id));
  const dbIds = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.kind === "endpoint-db" && endpointIds.has(edge.from)) {
      dbIds.add(edge.to);
    }
  }

  return graph.nodes.filter((node) => dbIds.has(node.id));
}

export function getPagesForDbModel(graph: Graph, modelName: string): Node[] {
  const dbNode = getDbNode(graph, modelName);
  if (!dbNode) {
    return [];
  }

  const endpointIds = new Set<string>();
  const pageIds = new Set<string>();
  const actionIds = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.kind === "endpoint-db" && edge.to === dbNode.id) {
      endpointIds.add(edge.from);
    }
  }

  if (endpointIds.size === 0) {
    return [];
  }

  for (const edge of graph.edges) {
    if (edge.kind === "page-endpoint" && endpointIds.has(edge.to)) {
      pageIds.add(edge.from);
    }

    if (edge.kind === "action-endpoint" && endpointIds.has(edge.to)) {
      actionIds.add(edge.from);
    }
  }

  if (actionIds.size > 0) {
    for (const edge of graph.edges) {
      if (edge.kind === "page-action" && actionIds.has(edge.to)) {
        pageIds.add(edge.from);
      }
    }
  }

  return graph.nodes.filter((node) => pageIds.has(node.id));
}
