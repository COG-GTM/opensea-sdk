import type { UploadContext } from "@opensea/api-types"

export type { UploadContext }

/**
 * File bytes accepted by {@link uploadToContext}. A `File` is a `Blob`, and a
 * Node `Buffer` is a `Uint8Array`.
 */
export type UploadContextFile = Blob | ArrayBuffer | Uint8Array

/**
 * A storage upload that returned a non-2xx status. Only the status is kept:
 * the response body is never read, because storage error bodies can echo
 * signed request material such as `StringToSign` or `AWSAccessKeyId`.
 */
export class UploadContextError extends Error {
  constructor(public status: number) {
    super(`Storage upload failed with HTTP ${status}`)
    this.name = "UploadContextError"
  }
}

/**
 * OpenSea upload contexts always point at HTTPS storage. Refusing anything else
 * keeps a hand-edited or foreign context from sending the file in cleartext or
 * to a non-network scheme.
 */
function assertHttpsUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("Upload context url is not a valid URL")
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `Upload context url must use https, not ${parsed.protocol.replace(/:$/, "")}`,
    )
  }
}

/**
 * `instanceof Blob` is false for a Blob or File from another realm (an iframe,
 * a worker), and copying one through `new Uint8Array` yields zero bytes, so
 * Blob-like values are recognized by shape instead.
 */
function isBlobLike(file: UploadContextFile): file is Blob {
  if (file instanceof Blob) return true
  const candidate = file as unknown as Partial<Blob>
  return (
    typeof candidate.arrayBuffer === "function" &&
    typeof candidate.size === "number" &&
    typeof candidate.type === "string"
  )
}

function toBlob(file: UploadContextFile): Blob {
  if (isBlobLike(file)) return file
  return new Blob([file instanceof ArrayBuffer ? file : new Uint8Array(file)])
}

/**
 * Narrow a value to a single `UploadContext`. An array (the shape
 * `createDropItemMediaUpload` returns) is accepted only with an `index`.
 *
 * This checks shape, not origin. Pass only a value that came from an OpenSea
 * API response, such as the `walletAuth` upload helpers, never untrusted
 * user-supplied JSON.
 */
export function selectUploadContext(
  value: unknown,
  index?: number,
): UploadContext {
  let candidate = value
  if (Array.isArray(value)) {
    if (index === undefined) {
      throw new Error(
        `Upload context is an array of ${value.length}; pass the index of the one to use`,
      )
    }
    if (!Number.isInteger(index) || index < 0 || index >= value.length) {
      throw new Error(
        `Index ${index} is out of range for ${value.length} upload contexts`,
      )
    }
    candidate = value[index]
  } else if (index !== undefined) {
    throw new Error("An index applies only to an array of upload contexts")
  }

  const context = candidate as Partial<UploadContext> | null
  if (
    !context ||
    typeof context !== "object" ||
    typeof context.url !== "string" ||
    typeof context.token !== "string" ||
    (context.method !== "POST" && context.method !== "PUT") ||
    !context.fields ||
    typeof context.fields !== "object"
  ) {
    throw new Error(
      "Not an upload context: expected an object with url, method (POST or PUT), fields and token",
    )
  }
  return context as UploadContext
}

/**
 * Perform the storage upload an `UploadContext` describes and return its
 * token for the follow-up OpenSea call.
 *
 * The request goes straight to the context's storage URL through the global
 * `fetch`, with no OpenSea API key or wallet token. For POST, every entry of
 * `fields` is sent unchanged as a multipart text field, then the file as the
 * last part, named `file`; the multipart boundary and Content-Type header are
 * left to fetch. For PUT, the bytes are sent as the body with no headers of
 * our own, so a `Blob` with a `type` sets the Content-Type and raw bytes set
 * none. Any 2xx response is success. The url must be HTTPS, and a redirect
 * fails the upload rather than resending the file elsewhere. The response
 * body is never read: it is cancelled on success and on failure.
 *
 * The file goes to whatever HTTPS URL the context names, so the context must
 * come from an OpenSea API response, such as the `walletAuth` upload helpers.
 *
 * @throws {UploadContextError} when storage answers with a non-2xx status.
 */
export async function uploadToContext(
  context: UploadContext,
  file: UploadContextFile,
  options?: { filename?: string; signal?: AbortSignal },
): Promise<{ token: string }> {
  const valid = selectUploadContext(context)
  assertHttpsUrl(valid.url)
  const blob = toBlob(file)
  let response: Response
  if (valid.method === "PUT") {
    response = await fetch(valid.url, {
      method: "PUT",
      body: blob,
      redirect: "error",
      signal: options?.signal,
    })
  } else {
    const form = new FormData()
    for (const [name, value] of Object.entries(valid.fields)) {
      form.append(name, value)
    }
    form.append("file", blob, options?.filename ?? "file")
    response = await fetch(valid.url, {
      method: "POST",
      body: form,
      redirect: "error",
      signal: options?.signal,
    })
  }

  await discardBody(response)
  if (!response.ok) throw new UploadContextError(response.status)
  return { token: valid.token }
}

async function discardBody(response: Response): Promise<void> {
  await Promise.resolve()
    .then(() => response.body?.cancel())
    .catch(() => undefined)
}
