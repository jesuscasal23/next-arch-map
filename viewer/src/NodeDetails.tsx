import type { Node } from "./types";

type NodeDetailsProps = {
  node: Node | null;
};

export function NodeDetails({ node }: NodeDetailsProps) {
  if (!node) {
    return (
      <div style={{ marginTop: 16, fontSize: 12, color: "#6b7280" }}>
        No node selected.
      </div>
    );
  }

  const filePath = node.meta?.filePath;

  return (
    <div style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 14, marginBottom: 8 }}>Selected node</h2>
      <div style={{ fontSize: 12, lineHeight: 1.5 }}>
        <div>
          <strong>id:</strong> {node.id}
        </div>
        <div>
          <strong>type:</strong> {node.type}
        </div>
        <div>
          <strong>label:</strong> {node.label}
        </div>
        {filePath !== undefined && filePath !== null && (
          <div>
            <strong>file:</strong> {String(filePath)}
          </div>
        )}
        {node.meta && (
          <pre
            style={{
              marginTop: 8,
              padding: 8,
              background: "#f7f7f7",
              borderRadius: 4,
              maxHeight: 160,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {JSON.stringify(node.meta, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
