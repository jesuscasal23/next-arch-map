import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import chokidar from "chokidar";
import { analyzeProject } from "./index.js";
import { generateDescribeContext } from "./describe.js";
import { diffGraphs } from "./diff.js";
import type { Graph, Node } from "./model.js";
import { getDbModelsForPage, getEndpointsForPage, getPagesForDbModel } from "./query.js";
import { readJsonFile, writeJsonFile } from "./utils.js";

export type ServeOptions = {
  projectRoot: string;
  port?: number;
  appDirs?: string[];
  graphPath?: string;
};

const PRESERVED_META_KEYS = ["description", "descriptionLong", "screenshot"];

function preserveMetaFields(freshGraph: Graph, existingGraph: Graph): void {
  const existingById = new Map<string, Node>();
  for (const node of existingGraph.nodes) {
    existingById.set(node.id, node);
  }

  for (const node of freshGraph.nodes) {
    const existing = existingById.get(node.id);
    if (!existing?.meta) continue;

    for (const key of PRESERVED_META_KEYS) {
      if (key in existing.meta) {
        if (!node.meta) node.meta = {};
        // Only carry forward if the fresh analysis didn't set it
        if (!(key in node.meta)) {
          node.meta[key] = existing.meta[key];
        }
      }
    }
  }
}

export async function serve(options: ServeOptions): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot);
  const port = options.port ?? 4321;
  const graphPath = path.resolve(
    projectRoot,
    options.graphPath ?? "arch/graph.full.json",
  );

  let currentGraph: Graph | null = null;
  let previousGraph: Graph | null = null;
  let isAnalyzing = false;
  let rerunRequested = false;
  let suppressGraphFileWatch = false;
  let hasShownDescribeHint = false;
  const describePath = path.resolve(
    projectRoot,
    path.join(path.dirname(options.graphPath ?? "arch/graph.full.json"), "describe-context.md"),
  );

  function readExistingGraph(): Graph | null {
    try {
      if (fs.existsSync(graphPath)) {
        return readJsonFile<Graph>(graphPath);
      }
    } catch {
      // ignore corrupt file
    }
    return null;
  }

  async function runAnalysis(): Promise<void> {
    if (isAnalyzing) {
      rerunRequested = true;
      return;
    }

    isAnalyzing = true;

    try {
      const nextGraph = await analyzeProject({
        projectRoot,
        appDirs: options.appDirs,
      });

      // Preserve descriptions/screenshots from the existing graph file
      const existingGraph = readExistingGraph();
      if (existingGraph) {
        preserveMetaFields(nextGraph, existingGraph);
      }

      previousGraph = currentGraph;
      currentGraph = nextGraph;

      // Write to disk so AI tools and the CLI can read/edit it
      suppressGraphFileWatch = true;
      writeJsonFile(graphPath, currentGraph);
      // Release suppression after a short delay for the watcher to settle
      setTimeout(() => {
        suppressGraphFileWatch = false;
      }, 500);

      // Generate describe context for AI agents
      generateDescribeContext({
        graphPath,
        outPath: describePath,
        onlyMissing: true,
      });

      const pageCount = currentGraph.nodes.filter((node) => node.type === "page").length;
      const endpointCount = currentGraph.nodes.filter((node) => node.type === "endpoint").length;
      const handlerCount = currentGraph.nodes.filter((node) => node.type === "handler").length;
      const actionCount = currentGraph.nodes.filter((node) => node.type === "action").length;
      const dbCount = currentGraph.nodes.filter((node) => node.type === "db").length;
      console.log(
        [
          "mode=serve",
          `pages=${pageCount}`,
          `actions=${actionCount}`,
          `endpoints=${endpointCount}`,
          `handlers=${handlerCount}`,
          `db=${dbCount}`,
          `nodes=${currentGraph.nodes.length}`,
          `edges=${currentGraph.edges.length}`,
        ].join(" "),
      );

      if (!hasShownDescribeHint) {
        hasShownDescribeHint = true;
        const relGraphPath = path.relative(process.cwd(), graphPath);
        const relDescribePath = path.relative(process.cwd(), describePath);
        console.log(
          "\n" +
            "To add AI-generated descriptions to the graph, tell your AI agent:\n" +
            "\n" +
            `  Read ${relDescribePath} and follow the instructions to update ${relGraphPath}\n`,
        );
      }
    } catch (error) {
      console.error("Analysis error:", error);
    } finally {
      isAnalyzing = false;

      if (rerunRequested) {
        rerunRequested = false;
        await runAnalysis();
      }
    }
  }

  await runAnalysis();

  // Watch source files for re-analysis
  const sourceWatcher = chokidar.watch(projectRoot, {
    ignored: ["**/node_modules/**", "**/.git/**", "**/.next/**", "**/arch/**"],
    ignoreInitial: true,
  });

  sourceWatcher.on("all", () => {
    void runAnalysis();
  });

  // Watch the graph file for external edits (e.g. AI adding descriptions)
  const graphWatcher = chokidar.watch(graphPath, { ignoreInitial: true });

  graphWatcher.on("change", () => {
    if (suppressGraphFileWatch) return;

    const updated = readExistingGraph();
    if (updated) {
      previousGraph = currentGraph;
      currentGraph = updated;
      console.log("mode=serve graph file updated externally, reloaded");
    }
  });

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin ?? "";
    const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (isLocalOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const requestUrl = req.url ? new URL(req.url, `http://localhost:${port}`) : null;
    const pathname = requestUrl?.pathname ?? "";

    if (req.method === "GET" && pathname === "/graph") {
      if (!currentGraph) {
        res.statusCode = 503;
        res.end("Graph not ready");
        return;
      }

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(currentGraph));
      return;
    }

    if (req.method === "GET" && pathname === "/diff") {
      if (!currentGraph || !previousGraph) {
        res.statusCode = 503;
        res.end("Diff not ready");
        return;
      }

      const diff = diffGraphs(previousGraph, currentGraph);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(diff));
      return;
    }

    if (req.method === "GET" && pathname === "/query/page-to-endpoints") {
      if (!currentGraph) {
        res.statusCode = 503;
        res.end("Graph not ready");
        return;
      }

      const route = requestUrl?.searchParams.get("route") ?? "/";
      const endpoints = getEndpointsForPage(currentGraph, route);

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ route, endpoints }));
      return;
    }

    if (req.method === "GET" && pathname === "/query/page-to-db") {
      if (!currentGraph) {
        res.statusCode = 503;
        res.end("Graph not ready");
        return;
      }

      const route = requestUrl?.searchParams.get("route") ?? "/";
      const dbModels = getDbModelsForPage(currentGraph, route);

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ route, dbModels }));
      return;
    }

    if (req.method === "GET" && pathname === "/query/db-to-pages") {
      if (!currentGraph) {
        res.statusCode = 503;
        res.end("Graph not ready");
        return;
      }

      const model = requestUrl?.searchParams.get("model");
      if (!model) {
        res.statusCode = 400;
        res.end("Missing model query parameter");
        return;
      }

      const pages = getPagesForDbModel(currentGraph, model);

      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ model, pages }));
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      console.log(`next-arch-map serve listening on http://localhost:${port}`);
      resolve();
    });
  });

  const close = async (): Promise<void> => {
    await sourceWatcher.close();
    await graphWatcher.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  };

  process.once("SIGINT", () => {
    void close().finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void close().finally(() => process.exit(0));
  });
}
