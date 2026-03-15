import type { Node, NodeType } from "./types";

type NodeDetailsProps = {
  node: Node | null;
};

const TYPE_BADGE_COLORS: Record<NodeType, string> = {
  page: "bg-blue-100 text-blue-700",
  endpoint: "bg-emerald-100 text-emerald-700",
  handler: "bg-teal-100 text-teal-700",
  db: "bg-red-100 text-red-700",
  action: "bg-purple-100 text-purple-700",
  service: "bg-violet-100 text-violet-700",
};

export function NodeDetails({ node }: NodeDetailsProps) {
  if (!node) {
    return (
      <div className="mt-5 py-4 text-center text-xs text-slate-400">Click a node to inspect</div>
    );
  }

  const filePath = node.meta?.filePath;

  return (
    <div className="mt-5 space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Selected node
      </h3>

      <div className="rounded-lg bg-white border border-slate-200/60 p-3 shadow-xs space-y-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${TYPE_BADGE_COLORS[node.type]}`}
          >
            {node.type}
          </span>
          <span className="text-sm font-medium text-slate-900 truncate">{node.label}</span>
        </div>

        <div className="text-[11px] text-slate-500 font-mono break-all">{node.id}</div>

        {(node.meta?.descriptionLong ?? node.meta?.description) ? (
          <p className="text-xs text-slate-600 leading-relaxed">
            {String(node.meta.descriptionLong ?? node.meta.description)}
          </p>
        ) : null}

        {filePath !== undefined && filePath !== null && (
          <div className="text-[11px] text-slate-500">
            <span className="text-slate-400">file: </span>
            <span className="font-mono">{String(filePath)}</span>
          </div>
        )}

        {node.meta?.screenshot ? (
          <div className="mt-2">
            <img
              src={String(node.meta.screenshot)}
              alt={`Screenshot of ${node.label}`}
              className="w-full rounded-md border border-slate-200"
            />
          </div>
        ) : null}

        {node.meta && (
          <pre className="mt-2 p-2.5 rounded-md bg-slate-50 border border-slate-100 text-[11px] font-mono text-slate-600 max-h-40 overflow-auto whitespace-pre-wrap break-all">
            {JSON.stringify(
              Object.fromEntries(
                Object.entries(node.meta).filter(
                  ([key]) =>
                    key !== "screenshot" && key !== "description" && key !== "descriptionLong",
                ),
              ),
              null,
              2,
            )}
          </pre>
        )}
      </div>
    </div>
  );
}
