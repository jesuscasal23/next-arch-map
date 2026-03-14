export type NodeType = "page" | "endpoint" | "db" | "ui" | "handler" | "action";

export type Node = {
  id: string;
  type: NodeType;
  label: string;
  meta?: Record<string, any>;
};

export type EdgeKind =
  | "page-endpoint"
  | "endpoint-db"
  | "page-ui"
  | "endpoint-handler"
  | "page-action"
  | "action-endpoint";

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
