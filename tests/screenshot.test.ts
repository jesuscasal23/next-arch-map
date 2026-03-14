import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  extractRouteParamNames,
  generateParamsTemplate,
  isDynamicRoute,
  resolveRoute,
  sanitizeFilename,
} from "../src/screenshot.js";
import type { Graph } from "../src/model.js";

describe("isDynamicRoute", () => {
  test("returns false for static routes", () => {
    expect(isDynamicRoute("/")).toBe(false);
    expect(isDynamicRoute("/about")).toBe(false);
    expect(isDynamicRoute("/users/settings")).toBe(false);
  });

  test("returns true for routes with dynamic segments", () => {
    expect(isDynamicRoute("/users/[id]")).toBe(true);
    expect(isDynamicRoute("/blog/[...slug]")).toBe(true);
    expect(isDynamicRoute("/docs/[[...path]]")).toBe(true);
    expect(isDynamicRoute("/[locale]/about")).toBe(true);
  });
});

describe("extractRouteParamNames", () => {
  test("extracts single param", () => {
    expect(extractRouteParamNames("/users/[id]")).toEqual(["id"]);
  });

  test("extracts multiple params", () => {
    expect(extractRouteParamNames("/users/[userId]/posts/[postId]")).toEqual([
      "userId",
      "postId",
    ]);
  });

  test("extracts catch-all params", () => {
    expect(extractRouteParamNames("/blog/[...slug]")).toEqual(["slug"]);
  });

  test("extracts optional catch-all params", () => {
    expect(extractRouteParamNames("/docs/[[...path]]")).toEqual(["path"]);
  });

  test("returns empty for static routes", () => {
    expect(extractRouteParamNames("/about")).toEqual([]);
  });
});

describe("resolveRoute", () => {
  test("substitutes single param", () => {
    expect(resolveRoute("/users/[id]", { id: "42" })).toBe("/users/42");
  });

  test("substitutes multiple params", () => {
    expect(
      resolveRoute("/users/[userId]/posts/[postId]", {
        userId: "1",
        postId: "99",
      }),
    ).toBe("/users/1/posts/99");
  });

  test("keeps unresolved params intact", () => {
    expect(resolveRoute("/users/[id]", {})).toBe("/users/[id]");
  });

  test("substitutes catch-all params", () => {
    expect(resolveRoute("/blog/[...slug]", { slug: "a/b" })).toBe(
      "/blog/a/b",
    );
  });
});

describe("sanitizeFilename", () => {
  test("converts root to index.png", () => {
    expect(sanitizeFilename("/")).toBe("index.png");
  });

  test("converts simple route", () => {
    expect(sanitizeFilename("/about")).toBe("about.png");
  });

  test("converts nested route", () => {
    expect(sanitizeFilename("/users/settings")).toBe("users-settings.png");
  });

  test("preserves dynamic brackets", () => {
    expect(sanitizeFilename("/users/[id]")).toBe("users-[id].png");
  });
});

describe("generateParamsTemplate", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "screenshot-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("generates template for dynamic routes only", () => {
    const graph: Graph = {
      nodes: [
        { id: "page:/", type: "page", label: "/", meta: { route: "/" } },
        {
          id: "page:/users/[id]",
          type: "page",
          label: "/users/[id]",
          meta: { route: "/users/[id]" },
        },
        {
          id: "page:/about",
          type: "page",
          label: "/about",
          meta: { route: "/about" },
        },
        {
          id: "endpoint:/api/users",
          type: "endpoint",
          label: "/api/users",
          meta: { route: "/api/users" },
        },
      ],
      edges: [],
    };

    const graphPath = path.join(tmpDir, "graph.json");
    const outPath = path.join(tmpDir, "params.json");
    fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));

    generateParamsTemplate({ graphPath, outPath });

    const result = JSON.parse(fs.readFileSync(outPath, "utf8"));
    expect(result).toEqual({
      "/users/[id]": { id: "" },
    });
  });

  test("handles multiple dynamic params", () => {
    const graph: Graph = {
      nodes: [
        {
          id: "page:/[locale]/posts/[postId]",
          type: "page",
          label: "/[locale]/posts/[postId]",
          meta: { route: "/[locale]/posts/[postId]" },
        },
      ],
      edges: [],
    };

    const graphPath = path.join(tmpDir, "graph2.json");
    const outPath = path.join(tmpDir, "params2.json");
    fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));

    generateParamsTemplate({ graphPath, outPath });

    const result = JSON.parse(fs.readFileSync(outPath, "utf8"));
    expect(result).toEqual({
      "/[locale]/posts/[postId]": { locale: "", postId: "" },
    });
  });
});
