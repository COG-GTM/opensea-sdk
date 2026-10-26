import { describe, expect, test, vi } from "vitest"
import { OpenSeaAPI } from "../../src/api/api"

/**
 * The generic `get` / `post` / `request` methods join `apiBaseUrl` and the
 * caller's `apiPath`. A path that does not start with a single "/" can move
 * the request to another host (`https://api.opensea.io@evil.example/x`), and
 * the API key and bearer token would follow it there.
 */
describe("generic request methods keep requests on the configured origin", () => {
  const ok = () =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    })

  const makeApi = () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    const api = new OpenSeaAPI({
      apiKey: "test-key",
      authToken: "test-jwt",
      fetch: fetchMock,
    })
    return { api, fetchMock }
  }

  const hostilePaths = [
    "@evil.example/api/v2/collections",
    ".evil.example/x",
    ":8443@evil.example/x",
    "//evil.example/x",
    "/\\evil.example/x",
    "evil.example/x",
    "",
  ]

  test.each(hostilePaths)("get rejects %j without calling fetch", async p => {
    const { api, fetchMock } = makeApi()
    await expect(api.get(p)).rejects.toThrow(/Invalid API path/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test.each(hostilePaths)("post rejects %j without calling fetch", async p => {
    const { api, fetchMock } = makeApi()
    await expect(api.post(p, { a: 1 })).rejects.toThrow(/Invalid API path/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test.each(
    hostilePaths,
  )("request rejects %j without calling fetch", async p => {
    const { api, fetchMock } = makeApi()
    await expect(api.request("DELETE", p)).rejects.toThrow(/Invalid API path/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("a normal path still reaches the configured host with credentials", async () => {
    const { api, fetchMock } = makeApi()
    await api.get("/api/v2/collections", { limit: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.origin).toBe("https://api.opensea.io")
    expect(url.pathname).toBe("/api/v2/collections")
    expect(url.searchParams.get("limit")).toBe("1")
    const init = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>
    }
    expect(init.headers["X-API-KEY"]).toBe("test-key")
    expect(init.headers.Authorization).toBe("Bearer test-jwt")
  })

  test("a custom apiBaseUrl with a path prefix keeps working", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    const api = new OpenSeaAPI({
      apiBaseUrl: "http://localhost:8080/proxy",
      fetch: fetchMock,
    })
    await api.post("/api/v2/offers", { a: 1 })
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://localhost:8080/proxy/api/v2/offers",
    )
  })
})
