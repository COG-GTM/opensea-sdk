import type { RegisteredToolResponse } from "@opensea/api-types"
import { camelizeKeysDeep } from "../utils/case"
import {
  getToolActivityPath,
  getToolPath,
  getToolsPath,
  getToolsSearchPath,
  getToolUsagePath,
} from "./apiPaths"
import type { Fetcher } from "./fetcher"
import type {
  GetToolActivityArgs,
  GetToolActivityResponse,
  GetToolResponse,
  ListToolsArgs,
  ListToolsResponse,
  ReportToolUsageRequest,
  ReportToolUsageResponse,
  SearchToolsArgs,
  SearchToolsResponse,
} from "./types"

/**
 * Tool registry operations. These are the spec's "Tool Endpoints [Beta]": they are under active
 * development and may change without notice. Saved tools are per-account and live on
 * `api.walletAuth` (`listSavedTools`, `saveTool`, `removeSavedTool`).
 *
 * @beta
 */
export class ToolsAPI {
  constructor(private fetcher: Fetcher) {}

  /**
   * List verified registered tools, newest first by default.
   * @beta
   */
  async listTools(args?: ListToolsArgs): Promise<ListToolsResponse> {
    return this.fetcher.get<ListToolsResponse>(getToolsPath(), args)
  }

  /**
   * Search verified registered tools by text, tags, creator, access type, source or gating
   * collection.
   * @beta
   */
  async searchTools(args?: SearchToolsArgs): Promise<SearchToolsResponse> {
    return this.fetcher.get<SearchToolsResponse>(getToolsSearchPath(), args)
  }

  /**
   * Get a registered tool by registry chain ID, registry address (an EVM address, or
   * `x402_bazaar` / `x402_bankr`) and tool ID.
   *
   * `inputs` and `outputs` are the tool's own JSON Schemas, keyed by tool-authored property
   * names, so they are returned as sent while the rest of the response is camelized.
   * @beta
   */
  async getTool(
    registryChain: string | number,
    registryAddr: string,
    toolId: string | number,
  ): Promise<GetToolResponse> {
    const raw = await this.fetcher.get<RegisteredToolResponse>(
      getToolPath(registryChain, registryAddr, toolId),
      undefined,
      { camelizeResponse: false },
    )
    const { inputs, outputs, ...fields } = raw
    return { ...camelizeKeysDeep(fields), inputs, outputs }
  }

  /**
   * Get x402 payment events and usage reports for a registered tool, deduplicated by
   * transaction hash. Paged by `limit` and `offset`.
   * @beta
   */
  async getToolActivity(
    registryChain: string | number,
    registryAddr: string,
    toolId: string | number,
    args?: GetToolActivityArgs,
  ): Promise<GetToolActivityResponse> {
    return this.fetcher.get<GetToolActivityResponse>(
      getToolActivityPath(registryChain, registryAddr, toolId),
      args,
    )
  }

  /**
   * Report a verified tool invocation, for metrics only. Nothing onchain happens, and the call
   * itself does not depend on the report.
   * @beta
   */
  async reportToolUsage(
    usage: ReportToolUsageRequest,
  ): Promise<ReportToolUsageResponse> {
    return this.fetcher.post<ReportToolUsageResponse>(getToolUsagePath(), usage)
  }
}
