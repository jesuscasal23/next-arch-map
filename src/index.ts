import { analyzeEndpointsToDb } from "./analyzers/endpointsToDb.js";
import { analyzePagesToEndpoints } from "./analyzers/pagesToEndpoints.js";
import { analyzePagesToUi } from "./analyzers/pagesToUi.js";
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
  uiImportPathGlobs?: string[];
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

  const pagesToUi = await analyzePagesToUi({
    projectRoot: options.projectRoot,
    appDirs: options.appDirs,
    uiImportPathGlobs: options.uiImportPathGlobs,
  });

  return mergePartial(mergePartial(pagesToEndpoints, endpointsToDb), pagesToUi);
}

export { diffGraphs } from "./diff.js";
export type { DiffStatus, EdgeDiff, GraphDiff, NodeDiff } from "./diff.js";
export type { Edge, EdgeKind, Graph, Node, NodeType } from "./model.js";
export { analyzePagesToEndpoints } from "./analyzers/pagesToEndpoints.js";
export { analyzeEndpointsToDb } from "./analyzers/endpointsToDb.js";
export { analyzePagesToUi } from "./analyzers/pagesToUi.js";
export { mergeGraphs, mergePartial } from "./merge.js";
export {
  getDbModelsForPage,
  getEndpointsForPage,
  getPagesForDbModel,
} from "./query.js";
