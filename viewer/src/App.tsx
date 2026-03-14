import { useEffect, useState, type ChangeEvent } from "react";
import { Filters } from "./Filters";
import { GraphView } from "./GraphView";
import { NodeDetails } from "./NodeDetails";
import type { DiffStatus, EdgeKind, Graph, GraphDiff, Node, NodeType } from "./types";

const ALL_NODE_TYPES: NodeType[] = [
  "page",
  "endpoint",
  "handler",
  "action",
  "db",
  "ui",
];
const ALL_EDGE_KINDS: EdgeKind[] = [
  "page-endpoint",
  "endpoint-db",
  "page-ui",
  "endpoint-handler",
  "page-action",
  "action-endpoint",
];

type LayerPreset = "user-flow" | "data-flow" | "full-flow";

const USER_FLOW_EDGE_KINDS: EdgeKind[] = [
  "page-action",
  "action-endpoint",
  "page-endpoint",
];

const DATA_FLOW_EDGE_KINDS: EdgeKind[] = [
  "endpoint-handler",
  "endpoint-db",
];

const FULL_FLOW_EDGE_KINDS: EdgeKind[] = [
  "page-endpoint",
  "endpoint-db",
  "page-ui",
  "endpoint-handler",
  "page-action",
  "action-endpoint",
];

const USER_FLOW_NODE_TYPES: NodeType[] = [
  "page",
  "action",
  "endpoint",
];

const DATA_FLOW_NODE_TYPES: NodeType[] = [
  "endpoint",
  "handler",
  "db",
];

const FULL_FLOW_NODE_TYPES: NodeType[] = [
  "page",
  "action",
  "endpoint",
  "handler",
  "db",
  "ui",
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
            setLoadError(`Server graph request failed: ${graphResponse.status}`);
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
        } catch (error) {
          console.error("Error fetching diff from server", error);
          if (!cancelled) {
            setGraphDiff(null);
          }
        }
      } catch (error) {
        console.error("Error fetching graph from server", error);
        if (!cancelled) {
          setGraph(null);
          setGraphDiff(null);
          setSelectedNodeId(null);
          setLoadError("Failed to fetch graph from server.");
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
      } catch (error) {
        console.error("Failed to parse graph JSON", error);
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

  const applyPreset = (preset: LayerPreset) => {
    if (preset === "user-flow") {
      setVisibleNodeTypes(new Set(USER_FLOW_NODE_TYPES));
      setVisibleEdgeKinds(new Set(USER_FLOW_EDGE_KINDS));
      return;
    }

    if (preset === "data-flow") {
      setVisibleNodeTypes(new Set(DATA_FLOW_NODE_TYPES));
      setVisibleEdgeKinds(new Set(DATA_FLOW_EDGE_KINDS));
      return;
    }

    setVisibleNodeTypes(new Set(FULL_FLOW_NODE_TYPES));
    setVisibleEdgeKinds(new Set(FULL_FLOW_EDGE_KINDS));
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
    } catch (error) {
      console.error("Error fetching page-to-db query", error);
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
  const graphModeLabel = graphDiff
    ? "Diff mode"
    : graph
      ? "Graph mode"
      : useServer
        ? "Server mode"
        : "No file loaded";
  const emptyStateLabel = useServer
    ? "Waiting for graph from server."
    : "Select a graph JSON file to visualize.";
  const nodeStatusById = graphDiff ? buildNodeStatusById(graphDiff) : undefined;
  const edgeStatusByKey = graphDiff ? buildEdgeStatusByKey(graphDiff) : undefined;

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
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)",
      }}
    >
      <aside
        style={{
          width: 260,
          padding: 16,
          borderRight: "1px solid rgba(148, 163, 184, 0.35)",
          boxSizing: "border-box",
          background: "rgba(255, 255, 255, 0.88)",
          backdropFilter: "blur(10px)",
          overflowY: "auto",
        }}
      >
        <h1 style={{ fontSize: 18, marginBottom: 12 }}>next-arch-map viewer</h1>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={useServer}
              onChange={(event) => setUseServer(event.target.checked)}
            />{" "}
            Use server (auto-refresh)
          </label>
          {useServer && (
            <input
              type="text"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              style={{ width: "100%", marginTop: 4, fontSize: 12 }}
              placeholder="http://localhost:4321"
            />
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
            Load graph or diff JSON
          </label>
          <input
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            disabled={useServer}
          />
        </div>

        {useServer && (
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: 8,
              background: "#f8fafc",
              border: "1px solid rgba(148, 163, 184, 0.25)",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Page to DB
            </div>
            <input
              type="text"
              value={queryRoute}
              onChange={(event) => setQueryRoute(event.target.value)}
              style={{ width: "100%", marginBottom: 8, fontSize: 12 }}
              placeholder="/dashboard"
            />
            <button
              type="button"
              onClick={() => void handlePageToDbQuery()}
              disabled={isQueryLoading}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: "#fff",
                fontSize: 12,
                cursor: isQueryLoading ? "wait" : "pointer",
              }}
            >
              {isQueryLoading ? "Loading..." : "Show DB for page"}
            </button>

            {queryError && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#991b1b" }}>{queryError}</div>
            )}

            {queryResult && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#334155" }}>
                {queryResult.length > 0 ? (
                  <pre
                    style={{
                      margin: 0,
                      padding: 8,
                      background: "#fff",
                      borderRadius: 6,
                      overflow: "auto",
                    }}
                  >
                    {JSON.stringify(queryResult, null, 2)}
                  </pre>
                ) : (
                  <div>No DB models found for this page.</div>
                )}
              </div>
            )}
          </div>
        )}

        {baseGraph && pageRoutes.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
              Focused page
            </label>
            <select
              value={focusedPageRoute ?? ""}
              onChange={(event) => setFocusedPageRoute(event.target.value || null)}
              style={{ width: "100%", fontSize: 13 }}
            >
              <option value="">(All pages)</option>
              {pageRoutes.map((route) => (
                <option key={route} value={route}>
                  {route}
                </option>
              ))}
            </select>
          </div>
        )}

        <div
          style={{
            marginBottom: 16,
            borderRadius: 8,
            padding: "10px 12px",
            background: graphDiff ? "#ecfdf5" : "#eff6ff",
            color: graphDiff ? "#166534" : "#1d4ed8",
            fontSize: 12,
          }}
        >
          {graphModeLabel}
        </div>

        {loadError && (
          <div
            style={{
              marginBottom: 16,
              borderRadius: 8,
              padding: "10px 12px",
              background: "#fee2e2",
              color: "#991b1b",
              fontSize: 12,
            }}
          >
            {loadError}
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>View preset</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <button
              type="button"
              style={{ fontSize: 11, padding: "2px 6px" }}
              onClick={() => applyPreset("user-flow")}
            >
              User Flow
            </button>
            <button
              type="button"
              style={{ fontSize: 11, padding: "2px 6px" }}
              onClick={() => applyPreset("data-flow")}
            >
              Data Flow
            </button>
            <button
              type="button"
              style={{ fontSize: 11, padding: "2px 6px" }}
              onClick={() => applyPreset("full-flow")}
            >
              Full Flow
            </button>
          </div>
        </div>

        <Filters
          allNodeTypes={ALL_NODE_TYPES}
          allEdgeKinds={ALL_EDGE_KINDS}
          visibleNodeTypes={visibleNodeTypes}
          visibleEdgeKinds={visibleEdgeKinds}
          onToggleNodeType={toggleNodeType}
          onToggleEdgeKind={toggleEdgeKind}
        />

        <NodeDetails node={selectedNode} />
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>
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
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#475569",
              padding: 24,
              boxSizing: "border-box",
            }}
          >
            <p>{emptyStateLabel}</p>
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
    "page-ui",
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
