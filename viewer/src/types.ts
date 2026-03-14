export type NodeType =
  | "page"
  | "endpoint"
  | "db"
  | "handler";

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
  | "action-endpoint";

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
