export type NodeType = "page" | "endpoint" | "db" | "ui";

export type Node = {
  id: string;
  type: NodeType;
  label: string;
  meta?: Record<string, any>;
};

export type EdgeKind = "page-endpoint" | "endpoint-db" | "page-ui";

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
