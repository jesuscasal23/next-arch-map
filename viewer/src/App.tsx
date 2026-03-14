import { useEffect, useState, type ChangeEvent } from "react";
import * as Switch from "@radix-ui/react-switch";
import { Filters } from "./Filters";
import { GraphView } from "./GraphView";
import { NodeDetails } from "./NodeDetails";
import type { DiffStatus, EdgeKind, Graph, GraphDiff, Node, NodeType } from "./types";

const ALL_NODE_TYPES: NodeType[] = [
  "page",
  "endpoint",
  "handler",
  "db",
];
const ALL_EDGE_KINDS: EdgeKind[] = [
  "page-endpoint",
  "endpoint-db",
  "endpoint-handler",
  "db-relation",
];


function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isGraph(value: unknown): value is Graph {
  if (!isRecord(value)) {
    return false;
  }

  const graph = value as Partial<Graph>;
  return Array.isArray(graph.nodes) && Array.isArray(graph.edges);
}

function isGraphDiff(value: unknown): value is GraphDiff {
  if (!isGraph(value)) {
    return false;
  }

  const firstNode = value.nodes[0];
  const firstEdge = value.edges[0];

  return (
    (isRecord(firstNode) && "node" in firstNode && "status" in firstNode) ||
    (isRecord(firstEdge) && "edge" in firstEdge && "status" in firstEdge)
  );
}

function buildEdgeKey(from: string, to: string, kind: EdgeKind): string {
  return `${from}::${to}::${kind}`;
}

export function App() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [graphDiff, setGraphDiff] = useState<GraphDiff | null>(null);
  const [useServer, setUseServer] = useState(true);
  const [serverUrl, setServerUrl] = useState("http://localhost:4321");
  const [focusedPageRoute, setFocusedPageRoute] = useState<string | null>(null);
  const [queryRoute, setQueryRoute] = useState("/dashboard");
  const [queryResult, setQueryResult] = useState<Node[] | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isQueryLoading, setIsQueryLoading] = useState(false);
  const [visibleNodeTypes, setVisibleNodeTypes] = useState<Set<NodeType>>(
    () => new Set(ALL_NODE_TYPES),
  );
  const [visibleEdgeKinds, setVisibleEdgeKinds] = useState<Set<EdgeKind>>(
    () => new Set(ALL_EDGE_KINDS),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setGraph(null);
    setGraphDiff(null);
    setFocusedPageRoute(null);
    setQueryResult(null);
    setQueryError(null);
    setSelectedNodeId(null);
    setLoadError(null);
  }, [useServer]);

  useEffect(() => {
    if (!useServer) {
      return;
    }

    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const graphResponse = await fetch(buildServerEndpoint(serverUrl, "/graph"));
        if (!graphResponse.ok) {
          if (!cancelled) {
            setGraph(null);
            setGraphDiff(null);
            setSelectedNodeId(null);
            setLoadError(`Server error: ${graphResponse.status}`);
          }
          return;
        }

        const nextGraph = (await graphResponse.json()) as Graph;
        if (!cancelled) {
          setGraph(nextGraph);
          setLoadError(null);
        }

        try {
          const diffResponse = await fetch(buildServerEndpoint(serverUrl, "/diff"));
          if (!diffResponse.ok) {
            if (!cancelled) {
              setGraphDiff(null);
            }
            return;
          }

          const nextDiff = (await diffResponse.json()) as GraphDiff;
          if (!cancelled) {
            setGraphDiff(nextDiff);
          }
        } catch {
          if (!cancelled) {
            setGraphDiff(null);
          }
        }
      } catch {
        if (!cancelled) {
          setGraph(null);
          setGraphDiff(null);
          setSelectedNodeId(null);
          setLoadError("Failed to connect to server.");
        }
      }
    }

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [serverUrl, useServer]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as unknown;
        if (isGraphDiff(parsed)) {
          setGraphDiff(parsed);
          setGraph(null);
          setSelectedNodeId(null);
          setLoadError(null);
          return;
        }

        if (!isGraph(parsed)) {
          throw new Error("Invalid graph shape");
        }

        setGraph(parsed);
        setGraphDiff(null);
        setSelectedNodeId(null);
        setLoadError(null);
      } catch {
        setGraph(null);
        setGraphDiff(null);
        setSelectedNodeId(null);
        setLoadError("Failed to parse graph JSON.");
      }
    };
    reader.onerror = () => {
      setGraph(null);
      setGraphDiff(null);
      setSelectedNodeId(null);
      setLoadError("Failed to read the selected file.");
    };
    reader.readAsText(file);
  };

  const toggleNodeType = (type: NodeType) => {
    setVisibleNodeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const toggleEdgeKind = (kind: EdgeKind) => {
    setVisibleEdgeKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const handlePageToDbQuery = async () => {
    setIsQueryLoading(true);
    setQueryError(null);

    try {
      const response = await fetch(
        buildServerEndpoint(
          serverUrl,
          `/query/page-to-db?route=${encodeURIComponent(queryRoute || "/")}`,
        ),
      );

      if (!response.ok) {
        throw new Error(`Query request failed: ${response.status}`);
      }

      const payload = (await response.json()) as { route: string; dbModels: Node[] };
      setQueryResult(payload.dbModels);
    } catch {
      setQueryResult(null);
      setQueryError("Failed to fetch page -> db query.");
    } finally {
      setIsQueryLoading(false);
    }
  };

  const baseGraph = getRenderedGraph(graph, graphDiff);
  const pageRoutes = getPageRoutes(baseGraph);
  const renderedGraph =
    focusedPageRoute && baseGraph
      ? buildFocusedSubgraph(baseGraph, focusedPageRoute)
      : baseGraph;
  const selectedNode =
    renderedGraph?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const nodeStatusById = graphDiff ? buildNodeStatusById(graphDiff) : undefined;
  const edgeStatusByKey = graphDiff ? buildEdgeStatusByKey(graphDiff) : undefined;

  const nodeCount = baseGraph?.nodes.length ?? 0;
  const edgeCount = baseGraph?.edges.length ?? 0;

  useEffect(() => {
    if (!baseGraph || pageRoutes.length === 0) {
      setFocusedPageRoute(null);
      return;
    }

    if (focusedPageRoute && !pageRoutes.includes(focusedPageRoute)) {
      setFocusedPageRoute(null);
    }
  }, [baseGraph, focusedPageRoute, pageRoutes]);

  return (
    <div className="flex h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      {/* Sidebar */}
      <aside className="w-72 flex-shrink-0 border-r border-sidebar-border bg-sidebar backdrop-blur-xl overflow-y-auto">
        <div className="p-5 space-y-5">
          {/* Header */}
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight">
              next-arch-map
            </h1>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Architecture graph viewer
            </p>
          </div>

          {/* Status badge */}
          {baseGraph ? (
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-xs text-slate-500">
                {nodeCount} nodes, {edgeCount} edges
                {graphDiff && (
                  <span className="ml-1 text-emerald-600 font-medium">
                    (diff)
                  </span>
                )}
              </span>
            </div>
          ) : loadError ? (
            <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">
              {loadError}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-300" />
              </span>
              <span className="text-xs text-slate-400">
                {useServer ? "Connecting..." : "No graph loaded"}
              </span>
            </div>
          )}

          {/* Server toggle */}
          <div className="rounded-lg bg-slate-50 border border-slate-200/60 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700" htmlFor="server-switch">
                Live server
              </label>
              <Switch.Root
                id="server-switch"
                checked={useServer}
                onCheckedChange={setUseServer}
                className="w-9 h-5 rounded-full bg-slate-200 transition-colors cursor-pointer"
              >
                <Switch.Thumb className="block w-4 h-4 rounded-full bg-white shadow-sm translate-x-0.5 transition-transform" />
              </Switch.Root>
            </div>
            {useServer && (
              <button
                type="button"
                onClick={() => setShowAdvanced((prev) => !prev)}
                className="text-[11px] text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                {showAdvanced ? "Hide" : "Advanced"}
              </button>
            )}
            {useServer && showAdvanced && (
              <input
                type="text"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                className="w-full text-[11px] font-mono px-2 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-shadow"
                placeholder="http://localhost:4321"
              />
            )}
            {!useServer && (
              <div>
                <label className="text-[11px] text-slate-500 block mb-1.5">
                  Load graph JSON
                </label>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={handleFileChange}
                  className="text-[11px] text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[11px] file:font-medium file:bg-indigo-50 file:text-indigo-600 hover:file:bg-indigo-100 file:cursor-pointer cursor-pointer"
                />
              </div>
            )}
          </div>

          {/* Page focus */}
          {baseGraph && pageRoutes.length > 0 && (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block mb-1.5">
                Focus page
              </label>
              <select
                value={focusedPageRoute ?? ""}
                onChange={(event) => setFocusedPageRoute(event.target.value || null)}
                className="w-full text-xs px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-shadow cursor-pointer"
              >
                <option value="">All pages</option>
                {pageRoutes.map((route) => (
                  <option key={route} value={route}>
                    {route}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Filters */}
          <Filters
            allNodeTypes={ALL_NODE_TYPES}
            allEdgeKinds={ALL_EDGE_KINDS}
            visibleNodeTypes={visibleNodeTypes}
            visibleEdgeKinds={visibleEdgeKinds}
            onToggleNodeType={toggleNodeType}
            onToggleEdgeKind={toggleEdgeKind}
            showAdvanced={showAdvanced}
          />

          {/* Query */}
          {useServer && (
            <div className="rounded-lg bg-slate-50 border border-slate-200/60 p-3 space-y-2.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Page to DB query
              </h3>
              <input
                type="text"
                value={queryRoute}
                onChange={(event) => setQueryRoute(event.target.value)}
                className="w-full text-xs font-mono px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-shadow"
                placeholder="/dashboard"
              />
              <button
                type="button"
                onClick={() => void handlePageToDbQuery()}
                disabled={isQueryLoading}
                className="w-full py-1.5 rounded-md text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-wait transition-colors cursor-pointer"
              >
                {isQueryLoading ? "Loading..." : "Query"}
              </button>

              {queryError && (
                <div className="text-xs text-red-600">{queryError}</div>
              )}

              {queryResult && (
                <div className="text-xs text-slate-600">
                  {queryResult.length > 0 ? (
                    <pre className="p-2 bg-white rounded-md border border-slate-100 overflow-auto max-h-32 text-[11px] font-mono">
                      {JSON.stringify(queryResult, null, 2)}
                    </pre>
                  ) : (
                    <span className="text-slate-400">No DB models found.</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Node details */}
          <NodeDetails node={selectedNode} />
        </div>
      </aside>

      {/* Graph area */}
      <main className="flex-1 min-w-0">
        {renderedGraph ? (
          <GraphView
            graph={renderedGraph}
            visibleNodeTypes={visibleNodeTypes}
            visibleEdgeKinds={visibleEdgeKinds}
            onSelectNode={setSelectedNodeId}
            selectedNodeId={selectedNodeId}
            nodeStatusById={nodeStatusById}
            edgeStatusByKey={edgeStatusByKey}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-3">
              <div className="text-4xl opacity-20">
                <svg className="mx-auto h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
              </div>
              <p className="text-sm text-slate-400">
                {useServer
                  ? "Waiting for graph from server..."
                  : "Load a graph JSON file to visualize"}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function buildServerEndpoint(baseUrl: string, pathname: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(pathname.replace(/^\//, ""), normalizedBase).toString();
}

function getRenderedGraph(graph: Graph | null, graphDiff: GraphDiff | null): Graph | null {
  if (graphDiff) {
    return {
      nodes: graphDiff.nodes.map((nodeDiff) => nodeDiff.node),
      edges: graphDiff.edges.map((edgeDiff) => edgeDiff.edge),
    };
  }

  return graph;
}

function getPageRoutes(graph: Graph | null): string[] {
  if (!graph) {
    return [];
  }

  return graph.nodes
    .filter((node) => node.type === "page")
    .map((node) => node.label)
    .sort((left, right) => left.localeCompare(right));
}

function buildFocusedSubgraph(graph: Graph, route: string): Graph {
  const pageId = `page:${route}`;
  const pageNode = graph.nodes.find((node) => node.id === pageId);

  if (!pageNode) {
    return graph;
  }

  const allowedEdgeKinds = new Set<EdgeKind>([
    "page-action",
    "action-endpoint",
    "page-endpoint",
    "endpoint-handler",
    "endpoint-db",
    "db-relation",
  ]);
  const reachableNodeIds = new Set<string>([pageId]);
  const worklist = [pageId];

  while (worklist.length > 0) {
    const currentId = worklist.pop();
    if (!currentId) {
      continue;
    }

    for (const edge of graph.edges) {
      if (!allowedEdgeKinds.has(edge.kind)) {
        continue;
      }

      if (edge.from === currentId && !reachableNodeIds.has(edge.to)) {
        reachableNodeIds.add(edge.to);
        worklist.push(edge.to);
      }
    }
  }

  const nodes = graph.nodes.filter((node) => reachableNodeIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  return { nodes, edges };
}

function buildNodeStatusById(graphDiff: GraphDiff): Map<string, DiffStatus> {
  const nodeStatusById = new Map<string, DiffStatus>();

  for (const nodeDiff of graphDiff.nodes) {
    nodeStatusById.set(nodeDiff.node.id, nodeDiff.status);
  }

  return nodeStatusById;
}

function buildEdgeStatusByKey(graphDiff: GraphDiff): Map<string, DiffStatus> {
  const edgeStatusByKey = new Map<string, DiffStatus>();

  for (const edgeDiff of graphDiff.edges) {
    edgeStatusByKey.set(
      buildEdgeKey(edgeDiff.edge.from, edgeDiff.edge.to, edgeDiff.edge.kind),
      edgeDiff.status,
    );
  }

  return edgeStatusByKey;
}
