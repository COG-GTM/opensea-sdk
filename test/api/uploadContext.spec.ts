import { inspect } from "node:util"
import { afterEach, describe, expect, it, vi } from "vitest"
import { OpenSeaAPI } from "../../src/api/api"
import {
  selectUploadContext,
  type UploadContext,
  UploadContextError,
  uploadToContext,
} from "../../src/api/uploadContext"

const postContext: UploadContext = {
  url: "https://uploads.example.com/",
  method: "POST",
  fields: {
    key: "uploads/example.png",
    "Content-Type": "image/png",
    success_action_status: "201",
  },
  token: "upload-token-post",
}

const putContext: UploadContext = {
  url: "https://uploads.example.com/object?X-Amz-Signature=sig",
  method: "PUT",
  fields: {},
  token: "upload-token-put",
}

type FetchCall = [string, RequestInit]

function stubFetch(response: () => Response = () => new Response(null)) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    response(),
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function onlyCall(fetchMock: ReturnType<typeof stubFetch>): FetchCall {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  return fetchMock.mock.calls[0] as FetchCall
}

async function failWith(
  body: BodyInit | null,
  status: number,
): Promise<UploadContextError> {
  stubFetch(() => new Response(body, { status }))
  const error = await uploadToContext(putContext, new Uint8Array([1])).catch(
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(UploadContextError)
  return error as UploadContextError
}

function countingStream(totalChunks = 10_000) {
  const chunk = new TextEncoder().encode("y".repeat(100))
  let pulled = 0
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled === totalChunks) {
        controller.close()
        return
      }
      pulled++
      controller.enqueue(chunk)
    },
    cancel() {
      cancelled = true
    },
  })
  return { stream, pulled: () => pulled, cancelled: () => cancelled }
}

async function bytesOf(value: unknown): Promise<number[]> {
  return Array.from(new Uint8Array(await (value as Blob).arrayBuffer()))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("uploadToContext", () => {
  it("POSTs every signed field unchanged, then the file last as `file`", async () => {
    const fetchMock = stubFetch()
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })

    const result = await uploadToContext(postContext, file, {
      filename: "avatar.png",
    })

    const [url, init] = onlyCall(fetchMock)
    expect(url).toBe("https://uploads.example.com/")
    expect(init.method).toBe("POST")
    expect(init.redirect).toBe("error")
    expect(init.headers).toBeUndefined()
    const form = init.body as FormData
    expect(Array.from(form.keys())).toEqual([
      "key",
      "Content-Type",
      "success_action_status",
      "file",
    ])
    expect(form.get("key")).toBe("uploads/example.png")
    expect(form.get("Content-Type")).toBe("image/png")
    expect(form.get("success_action_status")).toBe("201")
    const part = form.get("file") as File
    expect(part.name).toBe("avatar.png")
    expect(await bytesOf(part)).toEqual([1, 2, 3])
    expect(result).toEqual({ token: "upload-token-post" })
  })

  it("names the POST file part `file` when no filename is given", async () => {
    const fetchMock = stubFetch()

    await uploadToContext(postContext, new Uint8Array([9]))

    const [, init] = onlyCall(fetchMock)
    const part = (init.body as FormData).get("file") as File
    expect(part.name).toBe("file")
    expect(await bytesOf(part)).toEqual([9])
  })

  it("PUTs a Blob as the raw body with no headers of its own", async () => {
    const fetchMock = stubFetch()
    const file = new Blob([new Uint8Array([4, 5])], { type: "text/csv" })

    const result = await uploadToContext(putContext, file)

    const [url, init] = onlyCall(fetchMock)
    expect(url).toBe(putContext.url)
    expect(init.method).toBe("PUT")
    expect(init.redirect).toBe("error")
    expect(init.headers).toBeUndefined()
    expect(init.body).toBe(file)
    expect(result).toEqual({ token: "upload-token-put" })
  })

  it("PUTs Uint8Array and ArrayBuffer input as an untyped Blob of the same bytes", async () => {
    const fetchMock = stubFetch()
    const view = new Uint8Array([0, 6, 7, 8, 0]).subarray(1, 4)

    await uploadToContext(putContext, view)
    await uploadToContext(putContext, new Uint8Array([10, 11]).buffer)

    const [first, second] = fetchMock.mock.calls as unknown as FetchCall[]
    expect(first[1].body).toBeInstanceOf(Blob)
    expect((first[1].body as Blob).type).toBe("")
    expect(await bytesOf(first[1].body)).toEqual([6, 7, 8])
    expect(await bytesOf(second[1].body)).toEqual([10, 11])
  })

  it("PUTs a Blob from another realm unchanged instead of copying it to zero bytes", async () => {
    const fetchMock = stubFetch()
    const real = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
    const foreignRealmBlob = {
      size: real.size,
      type: real.type,
      arrayBuffer: () => real.arrayBuffer(),
      stream: () => real.stream(),
      slice: real.slice.bind(real),
      text: () => real.text(),
    } as unknown as Blob
    expect(foreignRealmBlob instanceof Blob).toBe(false)

    await uploadToContext(putContext, foreignRealmBlob)

    const [, init] = onlyCall(fetchMock)
    expect(init.body).toBe(foreignRealmBlob)
  })

  it("forwards the abort signal to fetch for PUT and POST", async () => {
    const fetchMock = stubFetch()
    const controller = new AbortController()
    const options = { signal: controller.signal }

    await uploadToContext(putContext, new Uint8Array([1]), options)
    await uploadToContext(postContext, new Uint8Array([1]), options)

    const [put, post] = fetchMock.mock.calls as unknown as FetchCall[]
    expect(put[1].signal).toBe(controller.signal)
    expect(post[1].signal).toBe(controller.signal)
  })

  it("reports only the status, never the signed request a storage error body echoes", async () => {
    const secrets = {
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      stringToSign: "AWS4-HMAC-SHA256\n20261018T000000Z\nsigned-scope-secret",
      signature:
        "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    }
    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<Error><Code>SignatureDoesNotMatch</Code>",
      "<Message>The request signature we calculated does not match the signature you provided.</Message>",
      `<AWSAccessKeyId>${secrets.accessKeyId}</AWSAccessKeyId>`,
      `<StringToSign>${secrets.stringToSign}</StringToSign>`,
      `<SignatureProvided>${secrets.signature}</SignatureProvided>`,
      "</Error>",
    ].join("")

    const error = await failWith(body, 403)

    expect(error.status).toBe(403)
    expect(error.message).toBe("Storage upload failed with HTTP 403")
    expect(Object.keys(error).sort()).toEqual(["name", "status"])
    const rendered = [
      error.message,
      String(error),
      inspect(error, { depth: null, showHidden: true }),
      ...Object.getOwnPropertyNames(error).map(name =>
        String((error as unknown as Record<string, unknown>)[name]),
      ),
    ]
    for (const text of rendered) {
      for (const secret of [
        ...Object.values(secrets),
        "SignatureDoesNotMatch",
        postContext.url,
        postContext.fields.key,
      ]) {
        expect(text).not.toContain(secret)
      }
    }
  })

  it("does not read a large error body and cancels it", async () => {
    const body = countingStream()
    stubFetch(() => new Response(body.stream, { status: 500 }))

    const error = await uploadToContext(putContext, new Uint8Array([1])).catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(UploadContextError)
    expect(body.pulled()).toBeLessThanOrEqual(1)
    expect(body.cancelled()).toBe(true)
  })

  it("cancels the response body after a successful PUT and POST", async () => {
    const putBody = countingStream()
    const postBody = countingStream()
    const bodies = [putBody, postBody]
    stubFetch(
      () =>
        new Response((bodies.shift() as typeof putBody).stream, {
          status: 200,
        }),
    )

    await expect(
      uploadToContext(putContext, new Uint8Array([1])),
    ).resolves.toEqual({ token: "upload-token-put" })
    await expect(
      uploadToContext(postContext, new Uint8Array([1])),
    ).resolves.toEqual({ token: "upload-token-post" })

    for (const body of [putBody, postBody]) {
      expect(body.pulled()).toBeLessThanOrEqual(1)
      expect(body.cancelled()).toBe(true)
    }
  })

  it("ignores a body whose cancel fails, on success and on failure", async () => {
    const failingCancel = () =>
      new ReadableStream<Uint8Array>({
        cancel() {
          throw new Error("cancel failed")
        },
      })

    stubFetch(() => new Response(failingCancel(), { status: 200 }))
    await expect(
      uploadToContext(putContext, new Uint8Array([1])),
    ).resolves.toEqual({ token: "upload-token-put" })

    const error = await failWith(failingCancel(), 500)
    expect(error.message).toBe("Storage upload failed with HTTP 500")
  })

  it("handles a response with no body on success and on failure", async () => {
    stubFetch(() => new Response(null, { status: 200 }))
    await expect(
      uploadToContext(postContext, new Uint8Array([1])),
    ).resolves.toEqual({ token: "upload-token-post" })

    const error = await failWith(null, 502)
    expect(error.message).toBe("Storage upload failed with HTTP 502")
  })

  it("treats any 2xx as success", async () => {
    stubFetch(() => new Response(null, { status: 204 }))

    await expect(
      uploadToContext(putContext, new Uint8Array([1])),
    ).resolves.toEqual({ token: "upload-token-put" })
  })

  it("refuses a non-https url without calling fetch", async () => {
    const fetchMock = stubFetch()

    await expect(
      uploadToContext(
        { ...postContext, url: "http://uploads.example.com/" },
        new Uint8Array([1]),
      ),
    ).rejects.toThrow("Upload context url must use https, not http")
    await expect(
      uploadToContext(
        { ...postContext, url: "not a url" },
        new Uint8Array([1]),
      ),
    ).rejects.toThrow("Upload context url is not a valid URL")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a malformed context or an unselected array without calling fetch", async () => {
    const fetchMock = stubFetch()
    const bytes = new Uint8Array([1])

    await expect(
      uploadToContext(
        { ...postContext, method: "GET" } as unknown as UploadContext,
        bytes,
      ),
    ).rejects.toThrow("Not an upload context")
    await expect(
      uploadToContext([postContext] as unknown as UploadContext, bytes),
    ).rejects.toThrow("Upload context is an array of 1")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends neither the API key nor the wallet token to storage", async () => {
    const responses = [
      () => new Response(JSON.stringify(postContext), { status: 200 }),
      () => new Response(null, { status: 204 }),
    ]
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      (responses.shift() as () => Response)(),
    )
    vi.stubGlobal("fetch", fetchMock)
    const api = new OpenSeaAPI({ apiKey: "secret-key", authToken: "jwt-123" })

    const context = await api.walletAuth.createProfileImageUpload({
      imageType: "profile_picture",
      contentType: "image/png",
    })
    await uploadToContext(context, new Uint8Array([1]))

    const [apiCall, storageCall] = fetchMock.mock
      .calls as unknown as FetchCall[]
    const apiHeaders = apiCall[1].headers as Record<string, string>
    expect(apiHeaders["X-API-KEY"]).toBe("secret-key")
    expect(apiHeaders.Authorization).toBe("Bearer jwt-123")
    expect(storageCall[0]).toBe("https://uploads.example.com/")
    expect(storageCall[1].headers).toBeUndefined()
    const sent = Array.from((storageCall[1].body as FormData).values())
      .filter(value => typeof value === "string")
      .join("\n")
    expect(sent).not.toContain("secret-key")
    expect(sent).not.toContain("jwt-123")
  })
})

describe("selectUploadContext", () => {
  const second = { ...putContext, token: "second" }

  it("returns a single context unchanged", () => {
    expect(selectUploadContext(postContext)).toBe(postContext)
  })

  it("picks an element of an array by index, including the last one", () => {
    expect(selectUploadContext([postContext, second], 0)).toBe(postContext)
    expect(selectUploadContext([postContext, second], 1)).toBe(second)
  })

  it("requires an index for an array", () => {
    expect(() => selectUploadContext([postContext, second])).toThrow(
      "Upload context is an array of 2; pass the index of the one to use",
    )
  })

  it("rejects an index at or past the end, negative, or fractional", () => {
    for (const index of [2, -1, 0.5]) {
      expect(() => selectUploadContext([postContext, second], index)).toThrow(
        `Index ${index} is out of range for 2 upload contexts`,
      )
    }
  })

  it("rejects an index for a single context", () => {
    expect(() => selectUploadContext(postContext, 0)).toThrow(
      "An index applies only to an array of upload contexts",
    )
  })

  it("rejects values missing any required field or with the wrong method", () => {
    const { token: _token, ...noToken } = postContext
    const { fields: _fields, ...noFields } = postContext
    const invalid: unknown[] = [
      null,
      "context",
      noToken,
      noFields,
      { ...postContext, url: 1 },
      { ...postContext, method: "GET" },
      { ...postContext, fields: null },
      { ...postContext, fields: "key=value" },
    ]
    for (const value of invalid) {
      expect(() => selectUploadContext(value)).toThrow(
        "Not an upload context: expected an object with url, method (POST or PUT), fields and token",
      )
    }
  })
})
