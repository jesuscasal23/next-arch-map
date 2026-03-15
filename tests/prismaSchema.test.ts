import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { analyzePrismaSchema } from "../src/analyzers/prismaSchema.js";

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

// ---------------------------------------------------------------------------
// Test 1: Basic model parsing with field types
// ---------------------------------------------------------------------------

describe("prismaSchema: basic model parsing", () => {
  let tmpDir: string;
  let result: Awaited<ReturnType<typeof analyzePrismaSchema>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-prisma-basic-"));

    writeFixtureFile(
      tmpDir,
      "prisma/schema.prisma",
      `
model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
}
`,
    );

    result = await analyzePrismaSchema(tmpDir);
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("creates db node with camelCase id", () => {
    const node = result.nodes.find((n) => n.id === "db:user");
    expect(node).toBeDefined();
    expect(node!.type).toBe("db");
    expect(node!.label).toBe("User");
  });

  it("parses columns with correct metadata", () => {
    const node = result.nodes.find((n) => n.id === "db:user")!;
    const columns = node.meta?.columns as Array<Record<string, unknown>>;
    expect(columns).toHaveLength(3);

    const idCol = columns.find((c) => c.name === "id")!;
    expect(idCol.type).toBe("Int");
    expect(idCol.isId).toBe(true);

    const emailCol = columns.find((c) => c.name === "email")!;
    expect(emailCol.type).toBe("String");
    expect(emailCol.isUnique).toBe(true);
    expect(emailCol.isRequired).toBe(true);

    const nameCol = columns.find((c) => c.name === "name")!;
    expect(nameCol.type).toBe("String");
    expect(nameCol.isRequired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Field attributes (@default, @map)
// ---------------------------------------------------------------------------

describe("prismaSchema: field attributes", () => {
  let tmpDir: string;
  let result: Awaited<ReturnType<typeof analyzePrismaSchema>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-prisma-attrs-"));

    writeFixtureFile(
      tmpDir,
      "prisma/schema.prisma",
      `
model Account {
  id        String   @id @default(uuid())
  balance   Decimal  @default(0)
  createdAt DateTime @default(now())
  dbAlias   String   @map("db_alias")
}
`,
    );

    result = await analyzePrismaSchema(tmpDir);
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("extracts @default values", () => {
    const node = result.nodes.find((n) => n.id === "db:account")!;
    const columns = node.meta?.columns as Array<Record<string, unknown>>;

    const idCol = columns.find((c) => c.name === "id")!;
    expect(idCol.default).toBe("uuid()");

    const balanceCol = columns.find((c) => c.name === "balance")!;
    expect(balanceCol.default).toBe("0");

    const createdAtCol = columns.find((c) => c.name === "createdAt")!;
    expect(createdAtCol.default).toBe("now()");
  });

  it("extracts @map value", () => {
    const node = result.nodes.find((n) => n.id === "db:account")!;
    const columns = node.meta?.columns as Array<Record<string, unknown>>;

    const aliasCol = columns.find((c) => c.name === "dbAlias")!;
    expect(aliasCol.map).toBe("db_alias");
  });
});

// ---------------------------------------------------------------------------
// Test 3: Relations (belongs-to and one-to-many)
// ---------------------------------------------------------------------------

describe("prismaSchema: relations", () => {
  let tmpDir: string;
  let result: Awaited<ReturnType<typeof analyzePrismaSchema>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-prisma-rels-"));

    writeFixtureFile(
      tmpDir,
      "prisma/schema.prisma",
      `
model User {
  id    Int    @id @default(autoincrement())
  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])
}
`,
    );

    result = await analyzePrismaSchema(tmpDir);
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("creates nodes for both models", () => {
    expect(result.nodes.find((n) => n.id === "db:user")).toBeDefined();
    expect(result.nodes.find((n) => n.id === "db:post")).toBeDefined();
  });

  it("creates db-relation edge from belongs-to side only", () => {
    const relationEdges = result.edges.filter((e) => e.kind === "db-relation");
    expect(relationEdges).toHaveLength(1);

    const edge = relationEdges[0];
    expect(edge.from).toBe("db:post");
    expect(edge.to).toBe("db:user");
  });

  it("does not include relation fields as columns", () => {
    const postNode = result.nodes.find((n) => n.id === "db:post")!;
    const columns = postNode.meta?.columns as Array<Record<string, unknown>>;
    const columnNames = columns.map((c) => c.name);

    // authorId is a column, author is a relation (not a column)
    expect(columnNames).toContain("authorId");
    expect(columnNames).not.toContain("author");
  });
});

// ---------------------------------------------------------------------------
// Test 4: Enum fields are treated as columns, not relations
// ---------------------------------------------------------------------------

describe("prismaSchema: enum fields", () => {
  let tmpDir: string;
  let result: Awaited<ReturnType<typeof analyzePrismaSchema>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-prisma-enum-"));

    writeFixtureFile(
      tmpDir,
      "prisma/schema.prisma",
      `
enum Role {
  ADMIN
  USER
}

model Employee {
  id   Int    @id @default(autoincrement())
  name String
  role Role   @default(USER)
}
`,
    );

    result = await analyzePrismaSchema(tmpDir);
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("treats enum field as column, not relation", () => {
    const node = result.nodes.find((n) => n.id === "db:employee")!;
    const columns = node.meta?.columns as Array<Record<string, unknown>>;
    const roleCol = columns.find((c) => c.name === "role");

    expect(roleCol).toBeDefined();
    expect(roleCol!.type).toBe("Role");
  });

  it("does not create relation edges for enum fields", () => {
    expect(result.edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 5: No schema file returns empty result
// ---------------------------------------------------------------------------

describe("prismaSchema: missing schema file", () => {
  let tmpDir: string;
  let result: Awaited<ReturnType<typeof analyzePrismaSchema>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-prisma-none-"));
    result = await analyzePrismaSchema(tmpDir);
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("returns empty nodes and edges", () => {
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Multiple models with multiple relations
// ---------------------------------------------------------------------------

describe("prismaSchema: complex schema", () => {
  let tmpDir: string;
  let result: Awaited<ReturnType<typeof analyzePrismaSchema>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-prisma-complex-"));

    writeFixtureFile(
      tmpDir,
      "prisma/schema.prisma",
      `
model User {
  id       Int       @id @default(autoincrement())
  email    String    @unique
  posts    Post[]
  comments Comment[]
}

model Post {
  id       Int       @id @default(autoincrement())
  title    String
  authorId Int
  author   User      @relation(fields: [authorId], references: [id])
  comments Comment[]
}

model Comment {
  id       Int    @id @default(autoincrement())
  text     String
  postId   Int
  post     Post   @relation(fields: [postId], references: [id])
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])
}
`,
    );

    result = await analyzePrismaSchema(tmpDir);
  });

  afterAll(() => fs.rmSync(tmpDir, { recursive: true }));

  it("creates all three model nodes", () => {
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.find((n) => n.id === "db:user")).toBeDefined();
    expect(result.nodes.find((n) => n.id === "db:post")).toBeDefined();
    expect(result.nodes.find((n) => n.id === "db:comment")).toBeDefined();
  });

  it("creates relation edges from belongs-to sides only", () => {
    const relationEdges = result.edges.filter((e) => e.kind === "db-relation");
    // Post->User, Comment->Post, Comment->User
    expect(relationEdges).toHaveLength(3);

    expect(relationEdges.some((e) => e.from === "db:post" && e.to === "db:user")).toBe(true);
    expect(relationEdges.some((e) => e.from === "db:comment" && e.to === "db:post")).toBe(true);
    expect(relationEdges.some((e) => e.from === "db:comment" && e.to === "db:user")).toBe(true);
  });
});
