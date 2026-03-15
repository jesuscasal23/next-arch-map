import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzeEndpointsToDb } from "../src/analyzers/endpointsToDb.js";

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

// ---------------------------------------------------------------------------
// Test 1: Basic handler detection (GET and POST exports)
// ---------------------------------------------------------------------------

describe("endpointsToDb: basic handler detection", () => {
  let tmpDir: string;
  let result: Awaited<ReturnType<typeof analyzeEndpointsToDb>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-e2db-handlers-"));

    writeFixtureFile(
      tmpDir,
      "app/api/users/route.ts",
      `
export async function GET() {
  return Response.json([]);
}

export async function POST(req: Request) {
  return Response.json({ ok: true });
}
`,
    );

    result = await analyzeEndpointsToDb({ projectRoot: tmpDir });
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("creates endpoint node", () => {
    expect(result.nodes.find((n) => n.id === "endpoint:/api/users")).toBeDefined();
  });

  it("creates handler nodes for GET and POST", () => {
    expect(result.nodes.find((n) => n.id === "handler:/api/users:GET")).toBeDefined();
    expect(result.nodes.find((n) => n.id === "handler:/api/users:POST")).toBeDefined();
  });

  it("creates endpoint-handler edges", () => {
    expect(
      result.edges.some(
        (e) =>
          e.kind === "endpoint-handler" &&
          e.from === "endpoint:/api/users" &&
          e.to === "handler:/api/users:GET",
      ),
    ).toBe(true);
    expect(
      result.edges.some(
        (e) =>
          e.kind === "endpoint-handler" &&
          e.from === "endpoint:/api/users" &&
          e.to === "handler:/api/users:POST",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Prisma model access detection
// ---------------------------------------------------------------------------

describe("endpointsToDb: prisma model access", () => {
  let tmpDir: string;
  let result: Awaited<ReturnType<typeof analyzeEndpointsToDb>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-e2db-prisma-"));

    writeFixtureFile(
      tmpDir,
      "app/api/users/route.ts",
      `
const prisma = {} as any;

export async function GET() {
  const users = await prisma.user.findMany();
  return Response.json(users);
}

export async function POST(req: Request) {
  const body = await req.json();
  const user = await prisma.user.create({ data: body });
  return Response.json(user);
}
`,
    );

    result = await analyzeEndpointsToDb({ projectRoot: tmpDir });
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("creates db node for user model", () => {
    expect(result.nodes.find((n) => n.id === "db:user")).toBeDefined();
  });

  it("creates endpoint-db edge", () => {
    expect(
      result.edges.some(
        (e) => e.kind === "endpoint-db" && e.from === "endpoint:/api/users" && e.to === "db:user",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Cross-module import tracing
// ---------------------------------------------------------------------------

describe("endpointsToDb: cross-module import tracing", () => {
  let tmpDir: string;
  let result: Awaited<ReturnType<typeof analyzeEndpointsToDb>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-e2db-import-"));

    writeFixtureFile(
      tmpDir,
      "app/api/orders/route.ts",
      `
import { listOrders } from "@/services/orders";

export async function GET() {
  const orders = await listOrders();
  return Response.json(orders);
}
`,
    );

    writeFixtureFile(
      tmpDir,
      "src/services/orders.ts",
      `
const prisma = {} as any;

export async function listOrders() {
  return prisma.order.findMany({ include: { items: true } });
}
`,
    );

    result = await analyzeEndpointsToDb({ projectRoot: tmpDir });
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("detects db model accessed through imported function", () => {
    expect(result.nodes.find((n) => n.id === "db:order")).toBeDefined();
    expect(
      result.edges.some(
        (e) => e.kind === "endpoint-db" && e.from === "endpoint:/api/orders" && e.to === "db:order",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 4: $transaction callback detection
// ---------------------------------------------------------------------------

describe("endpointsToDb: $transaction callback", () => {
  let tmpDir: string;
  let result: Awaited<ReturnType<typeof analyzeEndpointsToDb>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-e2db-tx-"));

    writeFixtureFile(
      tmpDir,
      "app/api/checkout/route.ts",
      `
const prisma = {} as any;

export async function POST(req: Request) {
  const body = await req.json();
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({ data: body });
    await tx.payment.create({ data: { orderId: order.id, amount: body.total } });
    return order;
  });
  return Response.json(result);
}
`,
    );

    result = await analyzeEndpointsToDb({ projectRoot: tmpDir });
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("detects db models accessed within $transaction callback", () => {
    expect(result.nodes.find((n) => n.id === "db:order")).toBeDefined();
    expect(result.nodes.find((n) => n.id === "db:payment")).toBeDefined();
  });

  it("creates endpoint-db edges for transaction models", () => {
    expect(
      result.edges.some(
        (e) =>
          e.kind === "endpoint-db" && e.from === "endpoint:/api/checkout" && e.to === "db:order",
      ),
    ).toBe(true);
    expect(
      result.edges.some(
        (e) =>
          e.kind === "endpoint-db" && e.from === "endpoint:/api/checkout" && e.to === "db:payment",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Re-export tracing through barrel file
// ---------------------------------------------------------------------------

describe("endpointsToDb: re-export tracing", () => {
  let tmpDir: string;
  let result: Awaited<ReturnType<typeof analyzeEndpointsToDb>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-e2db-reexport-"));

    writeFixtureFile(
      tmpDir,
      "app/api/products/route.ts",
      `
import { getAllProducts } from "@/lib/db";

export async function GET() {
  return Response.json(await getAllProducts());
}
`,
    );

    // Barrel re-export
    writeFixtureFile(
      tmpDir,
      "src/lib/db/index.ts",
      `
export { getAllProducts } from "./products";
`,
    );

    // Actual implementation
    writeFixtureFile(
      tmpDir,
      "src/lib/db/products.ts",
      `
const prisma = {} as any;

export async function getAllProducts() {
  return prisma.product.findMany();
}
`,
    );

    result = await analyzeEndpointsToDb({ projectRoot: tmpDir });
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("detects db model through barrel re-export chain", () => {
    expect(result.nodes.find((n) => n.id === "db:product")).toBeDefined();
    expect(
      result.edges.some(
        (e) =>
          e.kind === "endpoint-db" && e.from === "endpoint:/api/products" && e.to === "db:product",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Multiple models in a single handler
// ---------------------------------------------------------------------------

describe("endpointsToDb: multiple models in one handler", () => {
  let tmpDir: string;
  let result: Awaited<ReturnType<typeof analyzeEndpointsToDb>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-e2db-multi-"));

    writeFixtureFile(
      tmpDir,
      "app/api/dashboard/route.ts",
      `
const prisma = {} as any;

export async function GET() {
  const users = await prisma.user.count();
  const posts = await prisma.post.count();
  const comments = await prisma.comment.count();
  return Response.json({ users, posts, comments });
}
`,
    );

    result = await analyzeEndpointsToDb({ projectRoot: tmpDir });
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("detects all three db models", () => {
    expect(result.nodes.find((n) => n.id === "db:user")).toBeDefined();
    expect(result.nodes.find((n) => n.id === "db:post")).toBeDefined();
    expect(result.nodes.find((n) => n.id === "db:comment")).toBeDefined();
  });

  it("creates endpoint-db edges for all models", () => {
    const endpointDbEdges = result.edges.filter(
      (e) => e.kind === "endpoint-db" && e.from === "endpoint:/api/dashboard",
    );
    expect(endpointDbEdges).toHaveLength(3);
  });
});
