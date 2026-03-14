import * as Checkbox from "@radix-ui/react-checkbox";
import type { EdgeKind, NodeType } from "./types";

type FiltersProps = {
  allNodeTypes: NodeType[];
  allEdgeKinds: EdgeKind[];
  visibleNodeTypes: Set<NodeType>;
  visibleEdgeKinds: Set<EdgeKind>;
  onToggleNodeType: (type: NodeType) => void;
  onToggleEdgeKind: (kind: EdgeKind) => void;
};

const NODE_TYPE_COLORS: Record<NodeType, string> = {
  page: "bg-blue-500",
  endpoint: "bg-emerald-600",
  handler: "bg-teal-500",
  action: "bg-amber-400",
  db: "bg-red-600",
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
    <div className="space-y-5">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
          Node types
        </h3>
        <div className="space-y-1.5">
          {allNodeTypes.map((type) => (
            <label
              key={type}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <Checkbox.Root
                checked={visibleNodeTypes.has(type)}
                onCheckedChange={() => onToggleNodeType(type)}
                className="h-4 w-4 rounded border border-slate-300 bg-white flex items-center justify-center transition-colors data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
              >
                <Checkbox.Indicator>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M2 5L4 7L8 3"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Checkbox.Indicator>
              </Checkbox.Root>
              <span
                className={`h-2.5 w-2.5 rounded-full ${NODE_TYPE_COLORS[type]}`}
              />
              <span className="text-xs text-slate-600 group-hover:text-slate-900 transition-colors">
                {type}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
          Edge kinds
        </h3>
        <div className="space-y-1.5">
          {allEdgeKinds.map((kind) => (
            <label
              key={kind}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <Checkbox.Root
                checked={visibleEdgeKinds.has(kind)}
                onCheckedChange={() => onToggleEdgeKind(kind)}
                className="h-4 w-4 rounded border border-slate-300 bg-white flex items-center justify-center transition-colors data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
              >
                <Checkbox.Indicator>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M2 5L4 7L8 3"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Checkbox.Indicator>
              </Checkbox.Root>
              <span className="text-xs text-slate-600 group-hover:text-slate-900 transition-colors">
                {kind}
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
