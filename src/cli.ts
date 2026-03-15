#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { analyzeProject, diffGraphs } from "./index.js";
import type { Graph } from "./model.js";
import { generateDescribeContext } from "./describe.js";
import { captureScreenshots, generateParamsTemplate } from "./screenshot.js";
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

type DescribeCliOptions = {
  graphPath: string;
  outPath: string;
  all: boolean;
};

// ---------------------------------------------------------------------------
// Generic argument parser
// ---------------------------------------------------------------------------

type ArgDef =
  | { key: string; type: "string"; default?: string }
  | { key: string; type: "number"; default: number }
  | { key: string; type: "boolean" }
  | { key: string; type: "string[]" };

function parseArgs(
  args: string[],
  defs: Record<string, ArgDef>,
): Record<string, string | number | boolean | string[]> {
  const result: Record<string, string | number | boolean | string[]> = {};

  for (const def of Object.values(defs)) {
    if (def.type === "string[]") {
      result[def.key] = [];
    } else if (def.type === "boolean") {
      result[def.key] = false;
    } else if ("default" in def && def.default !== undefined) {
      result[def.key] = def.default;
    } else {
      result[def.key] = def.type === "number" ? 0 : "";
    }
  }

  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];

    if (flag === "--help" || flag === "-h") {
      printHelp();
      process.exit(0);
    }

    const def = defs[flag];
    if (!def) {
      throw new Error(`Unknown argument: ${flag}`);
    }

    if (def.type === "boolean") {
      result[def.key] = true;
      continue;
    }

    const value = args[i + 1];
    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }
    i += 1;

    if (def.type === "number") {
      const num = Number(value);
      if (!Number.isInteger(num) || num <= 0) {
        throw new Error(`Invalid ${flag}: ${value}`);
      }
      result[def.key] = num;
    } else if (def.type === "string[]") {
      (result[def.key] as string[]).push(value);
    } else {
      result[def.key] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Command-specific argument wrappers
// ---------------------------------------------------------------------------

function parseAnalyzeArgs(args: string[]): AnalyzeCliOptions {
  const raw = parseArgs(args, {
    "--project-root": { key: "projectRoot", type: "string", default: process.cwd() },
    "--out": { key: "out", type: "string", default: "arch/graph.full.json" },
    "--app-dir": { key: "appDirs", type: "string[]" },
  });
  const appDirs = raw.appDirs as string[];
  return {
    projectRoot: path.resolve(raw.projectRoot as string),
    out: raw.out as string,
    appDirs: appDirs.length > 0 ? appDirs : undefined,
  };
}

function parseDiffArgs(args: string[]): DiffCliOptions {
  const raw = parseArgs(args, {
    "--before": { key: "beforePath", type: "string" },
    "--after": { key: "afterPath", type: "string" },
    "--out": { key: "out", type: "string", default: "arch/graph.diff.json" },
  });
  if (!raw.beforePath || !raw.afterPath) {
    throw new Error("The diff command requires --before <path> and --after <path>.");
  }
  return {
    beforePath: raw.beforePath as string,
    afterPath: raw.afterPath as string,
    out: raw.out as string,
  };
}

function parseServeArgs(args: string[]): ServeCliOptions {
  const raw = parseArgs(args, {
    "--project-root": { key: "projectRoot", type: "string", default: process.cwd() },
    "--port": { key: "port", type: "number", default: 4321 },
    "--app-dir": { key: "appDirs", type: "string[]" },
  });
  const appDirs = raw.appDirs as string[];
  return {
    projectRoot: path.resolve(raw.projectRoot as string),
    port: raw.port as number,
    appDirs: appDirs.length > 0 ? appDirs : undefined,
  };
}

function parseDevArgs(args: string[]): DevCliOptions {
  const raw = parseArgs(args, {
    "--project-root": { key: "projectRoot", type: "string", default: process.cwd() },
    "--port": { key: "port", type: "number", default: 4321 },
    "--viewer-dir": { key: "viewerDir", type: "string" },
    "--app-dir": { key: "appDirs", type: "string[]" },
  });

  let viewerDir = raw.viewerDir as string;
  if (!viewerDir) {
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
  } else {
    viewerDir = path.resolve(viewerDir);
  }

  const appDirs = raw.appDirs as string[];
  return {
    projectRoot: path.resolve(raw.projectRoot as string),
    port: raw.port as number,
    viewerDir,
    appDirs: appDirs.length > 0 ? appDirs : undefined,
  };
}

function parseScreenshotArgs(args: string[]): ScreenshotCliOptions {
  const raw = parseArgs(args, {
    "--base-url": { key: "baseUrl", type: "string" },
    "--graph": { key: "graphPath", type: "string", default: "arch/graph.full.json" },
    "--out-dir": { key: "outDir", type: "string", default: "arch/screenshots" },
    "--params": { key: "paramsPath", type: "string", default: "arch/screenshot-params.json" },
    "--generate-params": { key: "generateParams", type: "boolean" },
  });
  return {
    baseUrl: raw.baseUrl as string,
    graphPath: raw.graphPath as string,
    outDir: raw.outDir as string,
    paramsPath: raw.paramsPath as string,
    generateParams: raw.generateParams as boolean,
  };
}

function parseDescribeArgs(args: string[]): DescribeCliOptions {
  const raw = parseArgs(args, {
    "--graph": { key: "graphPath", type: "string", default: "arch/graph.full.json" },
    "--out": { key: "outPath", type: "string", default: "arch/describe-context.md" },
    "--all": { key: "all", type: "boolean" },
  });
  return {
    graphPath: raw.graphPath as string,
    outPath: raw.outPath as string,
    all: raw.all as boolean,
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [commandOrArg, ...rest] = process.argv.slice(2);

  if (commandOrArg === "describe") {
    const options = parseDescribeArgs(rest);
    const result = generateDescribeContext({
      graphPath: path.resolve(options.graphPath),
      outPath: path.resolve(options.outPath),
      onlyMissing: !options.all,
    });
    console.log(`describe context written to ${options.outPath} (${result.nodeCount} nodes)`);
    console.log(
      `Tell your AI: "Read ${options.outPath} and update the descriptions in ${options.graphPath}"`,
    );
    return;
  }

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

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

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
next-arch-map describe [options]
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

Describe options:
  --graph <path>         Path to graph JSON. Defaults to arch/graph.full.json.
  --out <path>           Output context file. Defaults to arch/describe-context.md.
  --all                  Include all nodes, not just those missing descriptions.

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
