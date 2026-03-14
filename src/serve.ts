import http from "node:http";
import path from "node:path";
import chokidar from "chokidar";
import { analyzeProject } from "./index.js";
import { diffGraphs } from "./diff.js";
import type { Graph } from "./model.js";
import { getDbModelsForPage, getEndpointsForPage, getPagesForDbModel } from "./query.js";

export type ServeOptions = {
  projectRoot: string;
  port?: number;
  appDirs?: string[];
};

export async function serve(options: ServeOptions): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot);
  const port = options.port ?? 4321;

  let currentGraph: Graph | null = null;
  let previousGraph: Graph | null = null;
  let isAnalyzing = false;
  let rerunRequested = false;

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
      previousGraph = currentGraph;
      currentGraph = nextGraph;

      const pageCount = currentGraph.nodes.filter((node) => node.type === "page").length;
      const endpointCount = currentGraph.nodes.filter((node) => node.type === "endpoint").length;
      const handlerCount = currentGraph.nodes.filter((node) => node.type === "handler").length;
      const actionCount = currentGraph.nodes.filter((node) => node.type === "action").length;
      const dbCount = currentGraph.nodes.filter((node) => node.type === "db").length;
      const uiCount = currentGraph.nodes.filter((node) => node.type === "ui").length;

      console.log(
        [
          "mode=serve",
          `pages=${pageCount}`,
          `actions=${actionCount}`,
          `endpoints=${endpointCount}`,
          `handlers=${handlerCount}`,
          `db=${dbCount}`,
          `ui=${uiCount}`,
          `nodes=${currentGraph.nodes.length}`,
          `edges=${currentGraph.edges.length}`,
        ].join(" "),
      );
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

  const watcher = chokidar.watch(projectRoot, {
    ignored: ["**/node_modules/**", "**/.git/**", "**/.next/**", "**/arch/**"],
    ignoreInitial: true,
  });

  watcher.on("all", () => {
    void runAnalysis();
  });

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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
    server.listen(port, () => {
      server.off("error", reject);
      console.log(`next-arch-map serve listening on http://localhost:${port}`);
      resolve();
    });
  });

  const close = async (): Promise<void> => {
    await watcher.close();
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
