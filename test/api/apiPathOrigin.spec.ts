import { describe, expect, test, vi } from "vitest"
import { OpenSeaAPI } from "../../src/api/api"

/**
 * `get`, `post` and `request` build the URL by appending `apiPath` to `apiBaseUrl`, and `_fetch`
 * attaches the API key and wallet token to whatever URL comes out. A path that does not start
 * with a single `/` could move the request to another host, so it must be refused before any
 * request is sent.
 */
describe("API path origin check", () => {
  const ok = (body: unknown = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })

  const makeApi = (apiBaseUrl?: string) => {
    const fetchMock = vi.fn().mockImplementation(async () => ok({ ok: true }))
    const api = new OpenSeaAPI({
      apiKey: "secret-key",
      authToken: "wallet-jwt",
      fetch: fetchMock,
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
    })
    return { api, fetchMock }
  }

  const hostilePaths = [
    "@evil.example/api/v2/collections",
    ".evil.example/x",
    ":8443@evil.example/x",
    "//evil.example/x",
    "https://evil.example/x",
    "\\\\evil.example/x",
    "evil.example/x",
    "",
  ]

  describe.each(hostilePaths)("rejects %j", apiPath => {
    test("get", async () => {
      const { api, fetchMock } = makeApi()
      await expect(api.get(apiPath)).rejects.toThrow(/Invalid API path/)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    test("post", async () => {
      const { api, fetchMock } = makeApi()
      await expect(api.post(apiPath, { a: 1 })).rejects.toThrow(
        /Invalid API path/,
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

    test("request", async () => {
      const { api, fetchMock } = makeApi()
      await expect(api.request("DELETE", apiPath)).rejects.toThrow(
        /Invalid API path/,
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  test("rejects a non-string path", async () => {
    const { api, fetchMock } = makeApi()
    await expect(api.get(undefined as unknown as string)).rejects.toThrow(
      /Invalid API path/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("get on a valid path reaches the configured host with credentials", async () => {
    const { api, fetchMock } = makeApi()
    await api.get("/api/v2/collections", { limit: 2 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ]
    expect(new URL(url).origin).toBe("https://api.opensea.io")
    expect(url).toBe("https://api.opensea.io/api/v2/collections?limit=2")
    expect(init.headers["X-API-KEY"]).toBe("secret-key")
    expect(init.headers.Authorization).toBe("Bearer wallet-jwt")
  })

  test("post and request on a valid path keep working against a custom base URL", async () => {
    const { api, fetchMock } = makeApi("https://testnets-api.opensea.io")
    await api.post("/api/v2/offers", { a: 1 })
    await api.request("DELETE", "/api/v2/auth/tokens/abc")

    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      "https://testnets-api.opensea.io/api/v2/offers",
      "https://testnets-api.opensea.io/api/v2/auth/tokens/abc",
    ])
  })

  test("internal sub-client calls are unaffected", async () => {
    const { api, fetchMock } = makeApi()
    await api.collections.getCollection("azuki")
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.opensea.io/api/v2/collections/azuki",
    )
  })
})
