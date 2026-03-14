import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzePagesToEndpoints } from "../src/analyzers/pagesToEndpoints.js";
import { mergePartial } from "../src/merge.js";
import { diffGraphs } from "../src/diff.js";
import { getDbModelsForPage, getPagesForDbModel } from "../src/query.js";
import { analyzeProject } from "../src/index.js";
import type { Graph } from "../src/model.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function createFixture(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-test-"));

  writeFixtureFile(
    tmpDir,
    "app/dashboard/page.tsx",
    `
import { UserList } from "@/components/UserList";

export default function Dashboard() {
  const handleClick = async () => {
    const res = await fetch("/api/users");
    return res.json();
  };
  return <UserList onClick={handleClick} />;
}
`,
  );

  writeFixtureFile(
    tmpDir,
    "app/api/users/route.ts",
    `
const prisma = {} as any;

export async function GET() {
  const users = await prisma.user.findMany();
  return Response.json(users);
}
`,
  );

  writeFixtureFile(
    tmpDir,
    "app/layout.tsx",
    `
export default function RootLayout({ children }: { children: React.ReactNode }) {
  fetch("/api/health");
  return <html><body>{children}</body></html>;
}
`,
  );

  writeFixtureFile(
    tmpDir,
    "src/components/UserList.tsx",
    `
export function UserList({ onClick }: { onClick: () => void }) {
  return <div onClick={onClick}>Users</div>;
}
`,
  );

  return tmpDir;
}

// ===========================================================================
// Test 1: pagesToEndpoints — only page files produce page/action flows
// ===========================================================================

describe("pagesToEndpoints: page vs non-page files", () => {
  let tmpDir: string;
  let graph: Graph;

  beforeAll(async () => {
    tmpDir = createFixture();
    graph = await analyzePagesToEndpoints({ projectRoot: tmpDir });
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("page.tsx produces page -> action -> endpoint flow", () => {
    const pageNode = graph.nodes.find((n) => n.id === "page:/dashboard");
    const actionNodes = graph.nodes.filter(
      (n) => n.type === "action" && n.id.startsWith("action:/dashboard:"),
    );
    const endpointNode = graph.nodes.find((n) => n.id === "endpoint:/api/users");

    expect(pageNode).toBeDefined();
    expect(actionNodes.length).toBeGreaterThan(0);
    expect(endpointNode).toBeDefined();

    expect(graph.edges.some((e) => e.kind === "page-action" && e.from === pageNode!.id)).toBe(true);
    expect(graph.edges.some((e) => e.kind === "action-endpoint" && e.to === endpointNode!.id)).toBe(
      true,
    );
    expect(
      graph.edges.some(
        (e) => e.kind === "page-endpoint" && e.from === pageNode!.id && e.to === endpointNode!.id,
      ),
    ).toBe(true);
  });

  it("route.ts and layout.tsx do not produce page or action nodes", () => {
    // No page node derived from the API route handler
    expect(graph.nodes.find((n) => n.id === "page:/api/users")).toBeUndefined();
    expect(
      graph.nodes.filter((n) => n.type === "action" && n.id.startsWith("action:/api/users:")),
    ).toHaveLength(0);

    // layout.tsx is at app root — its route would be "/" but it is not a page file
    expect(graph.nodes.find((n) => n.id === "page:/")).toBeUndefined();
    expect(
      graph.nodes.filter((n) => n.type === "action" && n.id.startsWith("action:/:")),
    ).toHaveLength(0);
  });

  it("non-page files still contribute endpoint nodes", () => {
    // layout.tsx calls fetch("/api/health") — endpoint should exist, just no page flow
    expect(graph.nodes.find((n) => n.id === "endpoint:/api/health")).toBeDefined();
  });
});

// ===========================================================================
// Test 1b: pagesToEndpoints — follows imports to discover HTTP calls
// ===========================================================================

describe("pagesToEndpoints: follows imports transitively", () => {
  let tmpDir: string;
  let graph: Graph;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-import-test-"));

    // Page imports a hook from @/hooks/api
    writeFixtureFile(
      tmpDir,
      "src/app/trips/page.tsx",
      `
import { useTrips } from "@/hooks/api";

export default function TripsPage() {
  const { data } = useTrips();
  return <div>{JSON.stringify(data)}</div>;
}
`,
    );

    // Barrel re-export
    writeFixtureFile(
      tmpDir,
      "src/hooks/api/index.ts",
      `
export { useTrips } from "./useTrips";
`,
    );

    // Hook with the actual fetch call
    writeFixtureFile(
      tmpDir,
      "src/hooks/api/useTrips.ts",
      `
async function fetchTrips() {
  const res = await fetch("/api/v1/trips");
  return res.json();
}

export function useTrips() {
  return { queryFn: fetchTrips };
}
`,
    );

    graph = await analyzePagesToEndpoints({ projectRoot: tmpDir });
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("discovers page -> endpoint edge through imported hook", () => {
    const pageNode = graph.nodes.find((n) => n.id === "page:/trips");
    const endpointNode = graph.nodes.find((n) => n.id === "endpoint:/api/v1/trips");

    expect(pageNode).toBeDefined();
    expect(endpointNode).toBeDefined();

    expect(
      graph.edges.some(
        (e) => e.kind === "page-endpoint" && e.from === pageNode!.id && e.to === endpointNode!.id,
      ),
    ).toBe(true);
  });

  it("creates page -> action -> endpoint chain", () => {
    expect(graph.edges.some((e) => e.kind === "page-action" && e.from === "page:/trips")).toBe(
      true,
    );
    expect(
      graph.edges.some(
        (e) => e.kind === "action-endpoint" && e.to === "endpoint:/api/v1/trips",
      ),
    ).toBe(true);
  });
});

// ===========================================================================
// Test 1c: pagesToEndpoints — detects SDK client calls (e.g. Supabase)
// ===========================================================================

describe("pagesToEndpoints: detects SDK client calls", () => {
  let tmpDir: string;
  let graph: Graph;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-sdk-test-"));

    writeFixtureFile(
      tmpDir,
      "src/app/login/page.tsx",
      `
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const handleSubmit = async (email: string, password: string) => {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
  };
  return <form onSubmit={handleSubmit}><button>Login</button></form>;
}
`,
    );

    graph = await analyzePagesToEndpoints({ projectRoot: tmpDir });
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("creates service node for supabase", () => {
    const serviceNode = graph.nodes.find((n) => n.id === "service:supabase");
    expect(serviceNode).toBeDefined();
    expect(serviceNode!.type).toBe("service");
  });

  it("connects page to service with page-service edge", () => {
    expect(
      graph.edges.some(
        (e) =>
          e.kind === "page-service" &&
          e.from === "page:/login" &&
          e.to === "service:supabase",
      ),
    ).toBe(true);
  });
});

// ===========================================================================
// Test 2: mergePartial — metadata precedence on shared nodes
// ===========================================================================

describe("mergePartial: metadata precedence on shared nodes", () => {
  it("additions metadata overwrites base; base-only keys survive", () => {
    const base: Graph = {
      nodes: [
        {
          id: "endpoint:/api/users",
          type: "endpoint",
          label: "/api/users",
          meta: {
            filePath: "app/dashboard/page.tsx",
            route: "/api/users",
            callerInfo: "dashboard",
          },
        },
        {
          id: "page:/dashboard",
          type: "page",
          label: "/dashboard",
          meta: { filePath: "app/dashboard/page.tsx" },
        },
      ],
      edges: [],
    };

    const additions = {
      nodes: [
        {
          id: "endpoint:/api/users",
          type: "endpoint" as const,
          label: "/api/users",
          meta: { filePath: "app/api/users/route.ts", route: "/api/users" },
        },
        {
          id: "handler:/api/users:GET",
          type: "handler" as const,
          label: "/api/users#GET",
          meta: { filePath: "app/api/users/route.ts" },
        },
      ],
      edges: [],
    };

    const merged = mergePartial(base, additions);
    const endpoint = merged.nodes.find((n) => n.id === "endpoint:/api/users")!;

    // additions filePath wins
    expect(endpoint.meta!.filePath).toBe("app/api/users/route.ts");
    // base-only key survives
    expect(endpoint.meta!.callerInfo).toBe("dashboard");
    // base-only node preserved
    expect(merged.nodes.find((n) => n.id === "page:/dashboard")).toBeDefined();
    // additions-only node added
    expect(merged.nodes.find((n) => n.id === "handler:/api/users:GET")).toBeDefined();
  });
});

// ===========================================================================
// Test 3: diffGraphs — detects added, removed, modified, unchanged
// ===========================================================================

describe("diffGraphs: detects all four statuses", () => {
  it("correctly classifies nodes and edges", () => {
    const before: Graph = {
      nodes: [
        { id: "page:/a", type: "page", label: "/a", meta: { filePath: "a.tsx" } },
        { id: "page:/b", type: "page", label: "/b", meta: { filePath: "b.tsx" } },
        { id: "page:/c", type: "page", label: "/c", meta: { filePath: "c.tsx" } },
      ],
      edges: [
        { from: "page:/a", to: "endpoint:/x", kind: "page-endpoint" },
        { from: "page:/b", to: "endpoint:/y", kind: "page-endpoint", meta: { method: "GET" } },
      ],
    };

    const after: Graph = {
      nodes: [
        { id: "page:/b", type: "page", label: "/b", meta: { filePath: "b-moved.tsx" } },
        { id: "page:/c", type: "page", label: "/c", meta: { filePath: "c.tsx" } },
        { id: "page:/d", type: "page", label: "/d", meta: { filePath: "d.tsx" } },
      ],
      edges: [
        { from: "page:/b", to: "endpoint:/y", kind: "page-endpoint", meta: { method: "POST" } },
        { from: "page:/d", to: "endpoint:/z", kind: "page-endpoint" },
      ],
    };

    const diff = diffGraphs(before, after);

    const nodeStatus = (id: string) => diff.nodes.find((n) => n.node.id === id)?.status;
    expect(nodeStatus("page:/a")).toBe("removed");
    expect(nodeStatus("page:/b")).toBe("modified");
    expect(nodeStatus("page:/c")).toBe("unchanged");
    expect(nodeStatus("page:/d")).toBe("added");

    const edgeStatus = (from: string, to: string) =>
      diff.edges.find((e) => e.edge.from === from && e.edge.to === to)?.status;
    expect(edgeStatus("page:/a", "endpoint:/x")).toBe("removed");
    expect(edgeStatus("page:/b", "endpoint:/y")).toBe("modified");
    expect(edgeStatus("page:/d", "endpoint:/z")).toBe("added");
  });
});

// ===========================================================================
// Test 4: query — full graph traversal across analyzer boundaries
// ===========================================================================

describe("query: page -> endpoint -> db traversal", () => {
  const graph: Graph = {
    nodes: [
      { id: "page:/dashboard", type: "page", label: "/dashboard" },
      { id: "action:/dashboard:handleClick", type: "action", label: "handleClick" },
      { id: "endpoint:/api/users", type: "endpoint", label: "/api/users" },
      { id: "handler:/api/users:GET", type: "handler", label: "/api/users#GET" },
      { id: "db:User", type: "db", label: "User" },
      { id: "page:/settings", type: "page", label: "/settings" },
    ],
    edges: [
      { from: "page:/dashboard", to: "action:/dashboard:handleClick", kind: "page-action" },
      { from: "action:/dashboard:handleClick", to: "endpoint:/api/users", kind: "action-endpoint" },
      { from: "page:/dashboard", to: "endpoint:/api/users", kind: "page-endpoint" },
      { from: "endpoint:/api/users", to: "handler:/api/users:GET", kind: "endpoint-handler" },
      { from: "endpoint:/api/users", to: "db:User", kind: "endpoint-db" },
    ],
  };

  it("getDbModelsForPage follows page -> endpoint -> db", () => {
    const models = getDbModelsForPage(graph, "/dashboard");
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("db:User");
  });

  it("getPagesForDbModel follows db -> endpoint -> page (reverse)", () => {
    const pages = getPagesForDbModel(graph, "User");
    expect(pages).toHaveLength(1);
    expect(pages[0].id).toBe("page:/dashboard");
  });

  it("unconnected pages return empty results", () => {
    expect(getDbModelsForPage(graph, "/settings")).toHaveLength(0);
    expect(getPagesForDbModel(graph, "NonExistent")).toHaveLength(0);
  });
});

// ===========================================================================
// Test 5: end-to-end analyzeProject on a fixture
// ===========================================================================

describe("analyzeProject: full pipeline on fixture", () => {
  let tmpDir: string;
  let graph: Graph;

  beforeAll(async () => {
    tmpDir = createFixture();
    graph = await analyzeProject({ projectRoot: tmpDir });
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("produces all expected node types", () => {
    expect(graph.nodes.find((n) => n.id === "page:/dashboard")).toBeDefined();
    expect(
      graph.nodes.some((n) => n.type === "action" && n.id.startsWith("action:/dashboard:")),
    ).toBe(true);
    expect(graph.nodes.find((n) => n.id === "endpoint:/api/users")).toBeDefined();
    expect(graph.nodes.find((n) => n.id === "handler:/api/users:GET")).toBeDefined();
    expect(graph.nodes.find((n) => n.id === "db:user")).toBeDefined();
  });

  it("edges connect the full chain correctly", () => {
    const pageId = "page:/dashboard";
    const endpointId = "endpoint:/api/users";

    // page -> endpoint (direct)
    expect(
      graph.edges.some(
        (e) => e.kind === "page-endpoint" && e.from === pageId && e.to === endpointId,
      ),
    ).toBe(true);

    // endpoint -> handler
    expect(graph.edges.some((e) => e.kind === "endpoint-handler" && e.from === endpointId)).toBe(
      true,
    );

    // endpoint -> db
    expect(
      graph.edges.some(
        (e) => e.kind === "endpoint-db" && e.from === endpointId && e.to === "db:user",
      ),
    ).toBe(true);

  });
});
