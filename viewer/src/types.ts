// Keep in sync with src/model.ts and src/diff.ts (the backend is the source of truth).

export type NodeType = "page" | "endpoint" | "db" | "handler" | "action" | "service";

export type Node = {
  id: string;
  type: NodeType;
  label: string;
  meta?: Record<string, unknown>;
};

export type EdgeKind =
  | "page-endpoint"
  | "endpoint-db"
  | "endpoint-handler"
  | "page-action"
  | "action-endpoint"
  | "db-relation"
  | "page-service";

export type Edge = {
  from: string;
  to: string;
  kind: EdgeKind;
  meta?: Record<string, unknown>;
};

export type Graph = {
  nodes: Node[];
  edges: Edge[];
};

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

export function buildEdgeKey(from: string, to: string, kind: EdgeKind): string {
  return `${from}::${to}::${kind}`;
}
