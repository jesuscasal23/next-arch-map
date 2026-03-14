import { analyzeEndpointsToDb } from "./analyzers/endpointsToDb.js";
import { analyzePagesToEndpoints } from "./analyzers/pagesToEndpoints.js";
import type { Graph } from "./model.js";
import { mergePartial } from "./merge.js";

export type AnalyzeProjectOptions = {
  projectRoot: string;
  appDirs?: string[];
  extraScanDirs?: string[];
  apiDirs?: string[];
  httpClientIdentifiers?: string[];
  httpClientMethods?: string[];
  dbClientIdentifiers?: string[];
};

export async function analyzeProject(options: AnalyzeProjectOptions): Promise<Graph> {
  const pagesToEndpoints = await analyzePagesToEndpoints({
    projectRoot: options.projectRoot,
    appDirs: options.appDirs,
    extraScanDirs: options.extraScanDirs,
    httpClientIdentifiers: options.httpClientIdentifiers,
    httpClientMethods: options.httpClientMethods,
  });

  const endpointsToDb = await analyzeEndpointsToDb({
    projectRoot: options.projectRoot,
    apiDirs: options.apiDirs,
    dbClientIdentifiers: options.dbClientIdentifiers,
  });

  return mergePartial(pagesToEndpoints, endpointsToDb);
}

export { diffGraphs } from "./diff.js";
export type { DiffStatus, EdgeDiff, GraphDiff, NodeDiff } from "./diff.js";
export type { Edge, EdgeKind, Graph, Node, NodeType } from "./model.js";
export { analyzePagesToEndpoints } from "./analyzers/pagesToEndpoints.js";
export { analyzeEndpointsToDb } from "./analyzers/endpointsToDb.js";
export { mergeGraphs, mergePartial } from "./merge.js";
export { getDbModelsForPage, getEndpointsForPage, getPagesForDbModel } from "./query.js";
