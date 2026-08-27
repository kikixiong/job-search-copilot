import type { ViewerLauncher } from "@kikixiong/job-search-copilot-viewer";

type ViewerRuntimeOptions = Parameters<typeof import("@kikixiong/job-search-copilot-viewer")["createViewerLauncher"]>[0];

export function viewerRuntimeOptions(environment: NodeJS.ProcessEnv): Pick<ViewerRuntimeOptions, "openBrowser"> {
  return environment.JOB_SEARCH_COPILOT_NO_BROWSER === "1" ? { openBrowser: async () => {} } : {};
}

export type { ViewerLauncher };
