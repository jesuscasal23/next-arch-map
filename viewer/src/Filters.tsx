import type { EdgeKind, NodeType } from "./types";

type FiltersProps = {
  allNodeTypes: NodeType[];
  allEdgeKinds: EdgeKind[];
  visibleNodeTypes: Set<NodeType>;
  visibleEdgeKinds: Set<EdgeKind>;
  onToggleNodeType: (type: NodeType) => void;
  onToggleEdgeKind: (kind: EdgeKind) => void;
};

export function Filters(props: FiltersProps) {
  const {
    allNodeTypes,
    allEdgeKinds,
    visibleNodeTypes,
    visibleEdgeKinds,
    onToggleNodeType,
    onToggleEdgeKind,
  } = props;

  return (
    <div>
      <h2 style={{ fontSize: 14, marginBottom: 8 }}>Node types</h2>
      {allNodeTypes.map((type) => (
        <label key={type} style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={visibleNodeTypes.has(type)}
            onChange={() => onToggleNodeType(type)}
          />{" "}
          {type}
        </label>
      ))}

      <h2 style={{ fontSize: 14, marginTop: 16, marginBottom: 8 }}>Edge kinds</h2>
      {allEdgeKinds.map((kind) => (
        <label key={kind} style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={visibleEdgeKinds.has(kind)}
            onChange={() => onToggleEdgeKind(kind)}
          />{" "}
          {kind}
        </label>
      ))}
    </div>
  );
}
