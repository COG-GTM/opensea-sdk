import { describe, expect, test, vi } from "vitest"
import { OpenSeaAPI } from "../../src/api/api"

const REGISTRY = "0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1"

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })

const setup = (body: unknown) => {
  const fetch = vi.fn().mockResolvedValue(ok(body))
  const api = new OpenSeaAPI({ apiKey: "tools-key", fetch })
  const call = () => {
    const [url, init] = fetch.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body?: string },
    ]
    return { url: new URL(url), init }
  }
  return { api, fetch, call }
}

describe("API: ToolsAPI", () => {
  test("listTools sends GET /api/v2/tools with snake_case query and the API key", async () => {
    const { api, call } = setup({
      tools: [{ tool_id: "7", registry_chain: "8453", is_active: true }],
      next: "c2",
    })

    const result = await api.tools.listTools({
      sortBy: "oldest",
      type: "nft_gated",
      source: "onchain",
      limit: 5,
      cursor: "c1",
    })

    const { url, init } = call()
    expect(init.method).toBe("GET")
    expect(url.pathname).toBe("/api/v2/tools")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      sort_by: "oldest",
      type: "nft_gated",
      source: "onchain",
      limit: "5",
      cursor: "c1",
    })
    expect(init.headers["X-API-KEY"]).toBe("tools-key")
    expect(result).toEqual({
      tools: [{ toolId: "7", registryChain: "8453", isActive: true }],
      next: "c2",
    })
  })

  test("searchTools sends GET /api/v2/tools/search with tags repeated per value", async () => {
    const { api, call } = setup({ results: [], next: null })

    await api.tools.searchTools({
      query: "mogs",
      registryChain: "143",
      tags: ["nft", "monad"],
      accessType: "open",
      creator: "0xabc",
      source: "x402_bazaar",
      collection: "monad-mogs",
      sortBy: "most_used",
      includeDetails: false,
      limit: 10,
      cursor: "c1",
    })

    const { url, init } = call()
    expect(init.method).toBe("GET")
    expect(url.pathname).toBe("/api/v2/tools/search")
    expect(url.searchParams.getAll("tags")).toEqual(["nft", "monad"])
    expect(url.searchParams.get("registry_chain")).toBe("143")
    expect(url.searchParams.get("access_type")).toBe("open")
    expect(url.searchParams.get("include_details")).toBe("false")
    expect(url.searchParams.get("sort_by")).toBe("most_used")
    expect(url.searchParams.get("collection")).toBe("monad-mogs")
    expect(url.searchParams.get("cursor")).toBe("c1")
    expect(url.searchParams.has("registryChain")).toBe(false)
  })

  test("getTool sends GET to the composite-key path", async () => {
    const { api, call } = setup({ tool_id: "10" })

    await api.tools.getTool(143, REGISTRY, 10)

    const { url, init } = call()
    expect(init.method).toBe("GET")
    expect(url.pathname).toBe(`/api/v2/tools/143/${REGISTRY}/10`)
    expect(url.search).toBe("")
  })

  test("getTool encodes each key part as one path segment", async () => {
    const { api, call } = setup({ tool_id: "1" })

    await api.tools.getTool("8453", "x402/bazaar", "1?x=1")

    expect(call().url.pathname).toBe(
      "/api/v2/tools/8453/x402%2Fbazaar/1%3Fx%3D1",
    )
  })

  test("getTool camelizes fields but keeps the tool's input and output schemas as sent", async () => {
    const inputs = {
      type: "object",
      required: ["wallet_address"],
      properties: { wallet_address: { type: "string" } },
    }
    const outputs = { type: "object", properties: { next_action: {} } }
    const { api } = setup({
      tool_id: "10",
      display_name: "Mog Offer Sentinel",
      pricing_recipients: [{ amount_per_call: "0.01" }],
      inputs,
      outputs,
    })

    const tool = await api.tools.getTool("143", REGISTRY, "10")

    expect(tool.toolId).toBe("10")
    expect(tool.displayName).toBe("Mog Offer Sentinel")
    expect(tool.pricingRecipients).toEqual([{ amountPerCall: "0.01" }])
    expect(tool.inputs).toEqual(inputs)
    expect(tool.outputs).toEqual(outputs)
  })

  test("getToolActivity sends GET to the activity path with its paging args", async () => {
    const { api, call } = setup({
      activity: [{ caller_address: "0xcaller", tx_hash: "0xtx", paid: true }],
    })

    const result = await api.tools.getToolActivity("143", REGISTRY, "10", {
      includeCreatorPayments: true,
      limit: 25,
      offset: 50,
    })

    const { url, init } = call()
    expect(init.method).toBe("GET")
    expect(url.pathname).toBe(`/api/v2/tools/143/${REGISTRY}/10/activity`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      include_creator_payments: "true",
      limit: "25",
      offset: "50",
    })
    expect(result.activity).toEqual([
      { callerAddress: "0xcaller", txHash: "0xtx", paid: true },
    ])
  })

  test("reportToolUsage POSTs a snake_case body to /api/v2/tools/usage", async () => {
    const { api, call } = setup({
      id: "u1",
      verified: true,
      verification_type: "x402_settlement",
    })

    const result = await api.tools.reportToolUsage({
      verificationType: "x402_settlement",
      toolChainId: 8453,
      toolRegistryAddress: REGISTRY,
      toolOnchainId: 10,
      latencyMs: 120,
      x402: { callerAddress: "0xcaller", txHash: "0xtx", chainId: 8453 },
    })

    const { url, init } = call()
    expect(init.method).toBe("POST")
    expect(url.pathname).toBe("/api/v2/tools/usage")
    expect(init.headers["X-API-KEY"]).toBe("tools-key")
    expect(JSON.parse(init.body ?? "")).toEqual({
      verification_type: "x402_settlement",
      tool_chain_id: 8453,
      tool_registry_address: REGISTRY,
      tool_onchain_id: 10,
      latency_ms: 120,
      x402: { caller_address: "0xcaller", tx_hash: "0xtx", chain_id: 8453 },
    })
    expect(result).toEqual({
      id: "u1",
      verified: true,
      verificationType: "x402_settlement",
    })
  })
})
