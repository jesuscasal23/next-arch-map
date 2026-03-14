export type NodeType = "page" | "endpoint" | "db" | "handler" | "action" | "service";

export type Node = {
  id: string;
  type: NodeType;
  label: string;
  meta?: Record<string, any>;
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
  meta?: Record<string, any>;
};

export type Graph = {
  nodes: Node[];
  edges: Edge[];
};
