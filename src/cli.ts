#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { analyzeProject, diffGraphs } from "./index.js";
import type { Graph } from "./model.js";
import {
  captureScreenshots,
  generateParamsTemplate,
} from "./screenshot.js";
import { serve, type ServeOptions } from "./serve.js";
import { readJsonFile, writeJsonFile } from "./utils.js";

type AnalyzeCliOptions = {
  projectRoot: string;
  out: string;
  appDirs?: string[];
};

type DiffCliOptions = {
  beforePath: string;
  afterPath: string;
  out: string;
};

type ServeCliOptions = ServeOptions;

type DevCliOptions = {
  projectRoot: string;
  port: number;
  viewerDir: string;
  appDirs?: string[];
};

type ScreenshotCliOptions = {
  baseUrl: string;
  graphPath: string;
  outDir: string;
  paramsPath: string;
  generateParams: boolean;
};

async function main(): Promise<void> {
  const [commandOrArg, ...rest] = process.argv.slice(2);

  if (commandOrArg === "dev") {
    const options = parseDevArgs(rest);
    await runDev(options);
    return;
  }

  if (commandOrArg === "serve") {
    const options = parseServeArgs(rest);
    await serve(options);
    return;
  }

  if (commandOrArg === "screenshot") {
    const options = parseScreenshotArgs(rest);

    if (options.generateParams) {
      generateParamsTemplate({
        graphPath: path.resolve(options.graphPath),
        outPath: path.resolve(options.paramsPath),
      });
      console.log(`params template written to ${options.paramsPath}`);
      return;
    }

    if (!options.baseUrl) {
      throw new Error("The screenshot command requires --base-url <url>.");
    }

    const result = await captureScreenshots({
      baseUrl: options.baseUrl,
      graphPath: path.resolve(options.graphPath),
      outDir: path.resolve(options.outDir),
      paramsPath: path.resolve(options.paramsPath),
    });
    logScreenshotSummary(result);
    return;
  }

  if (commandOrArg === "diff") {
    const options = parseDiffArgs(rest);
    const beforePath = path.resolve(options.beforePath);
    const afterPath = path.resolve(options.afterPath);
    const outputFile = path.resolve(options.out);
    const beforeGraph = readJsonFile<Graph>(beforePath);
    const afterGraph = readJsonFile<Graph>(afterPath);
    const diff = diffGraphs(beforeGraph, afterGraph);

    writeJsonFile(outputFile, diff);
    logDiffSummary(diff, beforePath, afterPath, outputFile);
    return;
  }

  const analyzeArgs = commandOrArg === "analyze" ? rest : process.argv.slice(2);
  const options = parseAnalyzeArgs(analyzeArgs);
  const graph = await analyzeProject({
    projectRoot: options.projectRoot,
    appDirs: options.appDirs,
  });
  const outputFile = path.resolve(options.projectRoot, options.out);

  writeJsonFile(outputFile, graph);
  logAnalyzeSummary(graph, outputFile, options.projectRoot);
}

function parseAnalyzeArgs(args: string[]): AnalyzeCliOptions {
  let projectRoot = process.cwd();
  let out = "arch/graph.full.json";
  const appDirs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--project-root" && args[index + 1]) {
      projectRoot = path.resolve(args[index + 1]);
      index += 1;
      continue;
    }

    if (argument === "--out" && args[index + 1]) {
      out = args[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--app-dir" && args[index + 1]) {
      appDirs.push(args[index + 1]);
      index += 1;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return {
    projectRoot,
    out,
    appDirs: appDirs.length > 0 ? appDirs : undefined,
  };
}

function parseDiffArgs(args: string[]): DiffCliOptions {
  let beforePath = "";
  let afterPath = "";
  let out = "arch/graph.diff.json";

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--before" && args[index + 1]) {
      beforePath = args[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--after" && args[index + 1]) {
      afterPath = args[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--out" && args[index + 1]) {
      out = args[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!beforePath || !afterPath) {
    throw new Error("The diff command requires --before <path> and --after <path>.");
  }

  return {
    beforePath,
    afterPath,
    out,
  };
}

function parseServeArgs(args: string[]): ServeCliOptions {
  let projectRoot = process.cwd();
  let port = 4321;
  const appDirs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--project-root" && args[index + 1]) {
      projectRoot = path.resolve(args[index + 1]);
      index += 1;
      continue;
    }

    if (argument === "--port" && args[index + 1]) {
      port = Number(args[index + 1]);
      if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`Invalid port: ${args[index + 1]}`);
      }
      index += 1;
      continue;
    }

    if (argument === "--app-dir" && args[index + 1]) {
      appDirs.push(args[index + 1]);
      index += 1;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return {
    projectRoot,
    port,
    appDirs: appDirs.length > 0 ? appDirs : undefined,
  };
}

function parseDevArgs(args: string[]): DevCliOptions {
  let projectRoot = process.cwd();
  let port = 4321;
  let viewerDir = "";
  const appDirs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--project-root" && args[index + 1]) {
      projectRoot = path.resolve(args[index + 1]);
      index += 1;
      continue;
    }

    if (argument === "--port" && args[index + 1]) {
      port = Number(args[index + 1]);
      if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`Invalid port: ${args[index + 1]}`);
      }
      index += 1;
      continue;
    }

    if (argument === "--viewer-dir" && args[index + 1]) {
      viewerDir = path.resolve(args[index + 1]);
      index += 1;
      continue;
    }

    if (argument === "--app-dir" && args[index + 1]) {
      appDirs.push(args[index + 1]);
      index += 1;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!viewerDir) {
    // Try to find the viewer relative to the analyzer package
    const packageDir = path.dirname(path.dirname(new URL(import.meta.url).pathname));
    const builtinViewer = path.join(packageDir, "viewer");

    if (fs.existsSync(path.join(builtinViewer, "package.json"))) {
      viewerDir = builtinViewer;
    }

    if (!viewerDir) {
      throw new Error(
        "Could not find viewer directory. Provide --viewer-dir <path> pointing to the viewer app.",
      );
    }
  }

  return {
    projectRoot,
    port,
    viewerDir,
    appDirs: appDirs.length > 0 ? appDirs : undefined,
  };
}

function parseScreenshotArgs(args: string[]): ScreenshotCliOptions {
  let baseUrl = "";
  let graphPath = "arch/graph.full.json";
  let outDir = "arch/screenshots";
  let paramsPath = "arch/screenshot-params.json";
  let generateParams = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--base-url" && args[index + 1]) {
      baseUrl = args[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--graph" && args[index + 1]) {
      graphPath = args[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--out-dir" && args[index + 1]) {
      outDir = args[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--params" && args[index + 1]) {
      paramsPath = args[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--generate-params") {
      generateParams = true;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return { baseUrl, graphPath, outDir, paramsPath, generateParams };
}

async function runDev(options: DevCliOptions): Promise<void> {
  const children: ChildProcess[] = [];

  const cleanup = (): void => {
    for (const child of children) {
      child.kill("SIGTERM");
    }
  };

  process.once("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  // Start the analyzer serve process
  const serveProcess = spawn(
    process.execPath,
    [
      path.resolve(path.dirname(new URL(import.meta.url).pathname), "cli.js"),
      "serve",
      "--project-root",
      options.projectRoot,
      "--port",
      String(options.port),
      ...(options.appDirs ?? []).flatMap((dir) => ["--app-dir", dir]),
    ],
    { stdio: "inherit" },
  );
  children.push(serveProcess);

  // Install viewer dependencies if needed
  const viewerNodeModules = path.join(options.viewerDir, "node_modules");
  if (!fs.existsSync(viewerNodeModules)) {
    console.log("Installing viewer dependencies...");
    const installProcess = spawn("npm", ["install"], {
      cwd: options.viewerDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    await new Promise<void>((resolve, reject) => {
      installProcess.once("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npm install failed with code ${code}`));
        }
      });
    });
  }

  // Start the viewer dev server
  const viewerProcess = spawn("npm", ["run", "dev"], {
    cwd: options.viewerDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.push(viewerProcess);

  // If either process exits, tear down the other
  const onExit =
    (name: string) =>
    (code: number | null): void => {
      console.log(`${name} exited with code ${code}`);
      cleanup();
      process.exit(code ?? 1);
    };

  serveProcess.once("exit", onExit("analyzer"));
  viewerProcess.once("exit", onExit("viewer"));

  // Keep the process alive
  await new Promise<void>(() => {});
}

function logAnalyzeSummary(graph: Graph, outputFile: string, projectRoot: string): void {
  const pageCount = graph.nodes.filter((node) => node.type === "page").length;
  const endpointCount = graph.nodes.filter((node) => node.type === "endpoint").length;
  const dbCount = graph.nodes.filter((node) => node.type === "db").length;

  console.log(
    [
      `pages=${pageCount}`,
      `endpoints=${endpointCount}`,
      `db=${dbCount}`,
      `edges=${graph.edges.length}`,
      `file=${path.relative(projectRoot, outputFile)}`,
    ].join(" "),
  );
}

function logDiffSummary(
  diff: {
    nodes: Array<{ status: string }>;
    edges: Array<{ status: string }>;
  },
  beforePath: string,
  afterPath: string,
  outputFile: string,
): void {
  const addedNodes = diff.nodes.filter((node) => node.status === "added").length;
  const removedNodes = diff.nodes.filter((node) => node.status === "removed").length;
  const addedEdges = diff.edges.filter((edge) => edge.status === "added").length;
  const removedEdges = diff.edges.filter((edge) => edge.status === "removed").length;

  console.log(
    [
      "mode=diff",
      `before=${path.relative(process.cwd(), beforePath)}`,
      `after=${path.relative(process.cwd(), afterPath)}`,
      `out=${path.relative(process.cwd(), outputFile)}`,
      `nodes=${diff.nodes.length}`,
      `edges=${diff.edges.length}`,
      `addedNodes=${addedNodes}`,
      `removedNodes=${removedNodes}`,
      `addedEdges=${addedEdges}`,
      `removedEdges=${removedEdges}`,
    ].join(" "),
  );
}

function logScreenshotSummary(result: { captured: number; skipped: number }): void {
  console.log(
    [`mode=screenshot`, `captured=${result.captured}`, `skipped=${result.skipped}`].join(" "),
  );
}

function printHelp(): void {
  console.log(`next-arch-map analyze [options]
next-arch-map diff --before <path> --after <path> [--out <path>]
next-arch-map screenshot [options]
next-arch-map serve [options]
next-arch-map dev [options]

Analyze options:
  --project-root <path>  Project root to analyze. Defaults to the current working directory.
  --out <path>           Output JSON path, relative to the project root by default.
  --app-dir <path>       App Router directory to scan. Can be provided multiple times.

Diff options:
  --before <path>        Path to the baseline graph JSON.
  --after <path>         Path to the updated graph JSON.
  --out <path>           Output diff JSON path. Defaults to arch/graph.diff.json.

Screenshot options:
  --base-url <url>       Base URL of the running app (e.g. http://localhost:3000).
  --graph <path>         Path to graph JSON. Defaults to arch/graph.full.json.
  --out-dir <path>       Directory for screenshot PNGs. Defaults to arch/screenshots.
  --params <path>        Path to params JSON. Defaults to arch/screenshot-params.json.
  --generate-params      Generate a params template for dynamic routes and exit.

Serve options:
  --project-root <path>  Project root to analyze. Defaults to the current working directory.
  --port <number>        Port to listen on. Defaults to 4321.
  --app-dir <path>       App Router directory to scan. Can be provided multiple times.

Dev options:
  --project-root <path>  Project root to analyze. Defaults to the current working directory.
  --port <number>        Port for the analyzer server. Defaults to 4321.
  --viewer-dir <path>    Path to the viewer app. Auto-detected if bundled with the package.
  --app-dir <path>       App Router directory to scan. Can be provided multiple times.

General:
  --help                 Show this help message.`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
