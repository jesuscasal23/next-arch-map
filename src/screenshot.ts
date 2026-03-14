import fs from "node:fs";
import path from "node:path";
import type { Graph } from "./model.js";
import { readJsonFile, writeJsonFile } from "./utils.js";

const DYNAMIC_SEGMENT_PATTERN = /\[[\w.]+\]/;
const PARAM_SEGMENT_PATTERN = /\[{1,2}(?:\.{3})?(\w+)\]{1,2}/g;

export function isDynamicRoute(route: string): boolean {
  return DYNAMIC_SEGMENT_PATTERN.test(route);
}

export function extractRouteParamNames(route: string): string[] {
  const names: string[] = [];
  for (const match of route.matchAll(PARAM_SEGMENT_PATTERN)) {
    names.push(match[1]);
  }
  return names;
}

export function resolveRoute(
  route: string,
  params: Record<string, string>,
): string {
  return route.replace(PARAM_SEGMENT_PATTERN, (_match, name: string) => {
    return params[name] ?? _match;
  });
}

export function sanitizeFilename(route: string): string {
  if (route === "/") return "index.png";
  const name = route
    .replace(/^\//, "")
    .replace(/\//g, "-");
  return `${name}.png`;
}

export type GenerateParamsOptions = {
  graphPath: string;
  outPath: string;
};

export function generateParamsTemplate(options: GenerateParamsOptions): void {
  const graph = readJsonFile<Graph>(options.graphPath);
  const template: Record<string, Record<string, string>> = {};

  for (const node of graph.nodes) {
    if (node.type !== "page") continue;
    const route = node.meta?.route ?? node.label;
    if (!isDynamicRoute(String(route))) continue;

    const paramNames = extractRouteParamNames(String(route));
    const params: Record<string, string> = {};
    for (const name of paramNames) {
      params[name] = "";
    }
    template[String(route)] = params;
  }

  writeJsonFile(options.outPath, template);
}

export type CaptureScreenshotsOptions = {
  baseUrl: string;
  graphPath: string;
  outDir: string;
  paramsPath?: string;
};

export type CaptureResult = {
  graph: Graph;
  captured: number;
  skipped: number;
};

export async function captureScreenshots(
  options: CaptureScreenshotsOptions,
): Promise<CaptureResult> {
  let playwright: any;
  try {
    const moduleName = "playwright";
    playwright = await import(/* webpackIgnore: true */ moduleName);
  } catch {
    throw new Error(
      "Playwright is required for screenshots. Install it with: npm install playwright",
    );
  }

  const graph = readJsonFile<Graph>(options.graphPath);
  const params: Record<string, Record<string, string>> = options.paramsPath &&
    fs.existsSync(options.paramsPath)
    ? readJsonFile(options.paramsPath)
    : {};

  const pageNodes = graph.nodes
    .filter((node) => node.type === "page")
    .sort((a, b) => a.label.localeCompare(b.label));

  let captured = 0;
  let skipped = 0;

  const browser = await playwright.chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    for (const node of pageNodes) {
      const route = String(node.meta?.route ?? node.label);

      if (isDynamicRoute(route)) {
        const routeParams = params[route];
        if (!routeParams || Object.values(routeParams).some((v) => !v)) {
          console.log(`skipped ${route} (missing params)`);
          skipped += 1;
          continue;
        }

        const resolved = resolveRoute(route, routeParams);
        try {
          await capturePageScreenshot(page, node, resolved, options);
          captured += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`failed ${route}: ${message}`);
          skipped += 1;
        }
      } else {
        try {
          await capturePageScreenshot(page, node, route, options);
          captured += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`failed ${route}: ${message}`);
          skipped += 1;
        }
      }
    }
  } finally {
    await browser.close();
  }

  writeJsonFile(options.graphPath, graph);
  return { graph, captured, skipped };
}
async function capturePageScreenshot(
  page: any,
  node: Graph["nodes"][number],
  resolvedRoute: string,
  options: CaptureScreenshotsOptions,
): Promise<void> {
  const url = options.baseUrl.replace(/\/$/, "") + resolvedRoute;
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

  const buffer: Buffer = await page.screenshot({ fullPage: true });

  fs.mkdirSync(options.outDir, { recursive: true });
  const filename = sanitizeFilename(resolvedRoute);
  fs.writeFileSync(path.join(options.outDir, filename), buffer);

  if (!node.meta) node.meta = {};
  node.meta.screenshot = `data:image/png;base64,${buffer.toString("base64")}`;

  console.log(`captured ${resolvedRoute} → ${filename}`);
}
