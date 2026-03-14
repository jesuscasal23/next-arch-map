#!/usr/bin/env node

import path from "node:path";
import { analyzeProject } from "./index.js";
import type { Graph } from "./model.js";
import { writeJsonFile } from "./utils.js";

type CliOptions = {
  projectRoot: string;
  out: string;
  appDirs?: string[];
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const graph = await analyzeProject({
    projectRoot: options.projectRoot,
    appDirs: options.appDirs,
  });
  const outputFile = path.resolve(options.projectRoot, options.out);

  writeJsonFile(outputFile, graph);
  logSummary(graph, outputFile, options.projectRoot);
}

function parseArgs(args: string[]): CliOptions {
  const filteredArgs = args[0] === "analyze" ? args.slice(1) : args;
  let projectRoot = process.cwd();
  let out = "arch/graph.full.json";
  const appDirs: string[] = [];

  for (let index = 0; index < filteredArgs.length; index += 1) {
    const argument = filteredArgs[index];

    if (argument === "--project-root" && filteredArgs[index + 1]) {
      projectRoot = path.resolve(filteredArgs[index + 1]);
      index += 1;
      continue;
    }

    if (argument === "--out" && filteredArgs[index + 1]) {
      out = filteredArgs[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--app-dir" && filteredArgs[index + 1]) {
      appDirs.push(filteredArgs[index + 1]);
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

function logSummary(graph: Graph, outputFile: string, projectRoot: string): void {
  const pageCount = graph.nodes.filter((node) => node.type === "page").length;
  const endpointCount = graph.nodes.filter((node) => node.type === "endpoint").length;
  const dbCount = graph.nodes.filter((node) => node.type === "db").length;
  const uiCount = graph.nodes.filter((node) => node.type === "ui").length;

  console.log(
    [
      `pages=${pageCount}`,
      `endpoints=${endpointCount}`,
      `db=${dbCount}`,
      `ui=${uiCount}`,
      `edges=${graph.edges.length}`,
      `file=${path.relative(projectRoot, outputFile)}`,
    ].join(" ")
  );
}

function printHelp(): void {
  console.log(`next-arch-map analyze [options]

Options:
  --project-root <path>  Project root to analyze. Defaults to the current working directory.
  --out <path>           Output JSON path, relative to the project root by default.
  --app-dir <path>       App Router directory to scan. Can be provided multiple times.
  --help                 Show this help message.`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
