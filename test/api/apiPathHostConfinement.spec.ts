import { afterEach, describe, expect, test, vi } from "vitest"
import { OpenSeaAPI } from "../../src/api/api"

/**
 * `get`, `post` and `request` join `apiBaseUrl` and `apiPath` as text, and `_fetch` attaches the
 * API key and bearer token to whatever URL comes out. A path such as `@evil.example/x` would make
 * `evil.example` the host, so these methods must refuse any path that leaves `apiBaseUrl`'s origin
 * before a request is sent.
 */
describe("generic request methods confine apiPath to apiBaseUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const ok = (body: unknown = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })

  const makeApi = (apiBaseUrl?: string) => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(ok()))
    const api = new OpenSeaAPI({
      apiKey: "secret-key",
      authToken: "jwt",
      fetch: fetchMock,
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
    })
    return { api, fetchMock }
  }

  const hostilePaths = [
    "@evil.example/api/v2/x",
    ".evil.example/x",
    ":443@evil.example/x",
    "//evil.example/x",
    "/\\evil.example/x",
    "https://evil.example/x",
    "evil",
    "",
  ]

  describe.each(hostilePaths)("rejects %j", path => {
    test("get", async () => {
      const { api, fetchMock } = makeApi()
      await expect(api.get(path)).rejects.toBeInstanceOf(RangeError)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    test("post", async () => {
      const { api, fetchMock } = makeApi()
      await expect(api.post(path, { a: 1 })).rejects.toBeInstanceOf(RangeError)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    test("request", async () => {
      const { api, fetchMock } = makeApi()
      await expect(api.request("POST", path)).rejects.toBeInstanceOf(RangeError)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  test("a normal path still reaches the API host with both credentials", async () => {
    const { api, fetchMock } = makeApi()
    await api.get("/api/v2/collections", { limit: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.opensea.io/api/v2/collections?limit=1",
    )
    const init = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>
    }
    expect(init.headers["X-API-KEY"]).toBe("secret-key")
    expect(init.headers.Authorization).toBe("Bearer jwt")
  })

  test("request and post keep working for normal paths", async () => {
    const { api, fetchMock } = makeApi()
    await api.request("DELETE", "/api/v2/x")
    await api.post("/api/v2/y", { a: 1 })

    expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual([
      "https://api.opensea.io/api/v2/x",
      "https://api.opensea.io/api/v2/y",
    ])
  })

  test("typed helpers are unaffected", async () => {
    const { api, fetchMock } = makeApi()
    await api.collections.getCollection("azuki")
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.opensea.io/api/v2/collections/azuki",
    )
  })

  test("a custom absolute apiBaseUrl with a path prefix is kept", async () => {
    const { api, fetchMock } = makeApi("https://proxy.example/opensea")
    await api.get("/api/v2/collections")
    await expect(api.get("@evil.example/x")).rejects.toBeInstanceOf(RangeError)
    expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual([
      "https://proxy.example/opensea/api/v2/collections",
    ])
  })

  test("a relative apiBaseUrl (same-origin proxy) is kept", async () => {
    const { api, fetchMock } = makeApi("/opensea-proxy")
    await api.collections.getCollection("azuki")
    await api.post("/api/v2/y", {})
    await expect(api.get(".evil.example/x")).rejects.toBeInstanceOf(RangeError)
    expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual([
      "/opensea-proxy/api/v2/collections/azuki",
      "/opensea-proxy/api/v2/y",
    ])
  })
})
