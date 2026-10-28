import type {
  OperationRequestBody,
  OperationResponse,
} from "@opensea/api-types"
import { getAddress } from "ethers"
import { type FetchImpl, fetchWith } from "../utils/fetchTransport"
import type { AuthSigner } from "./types"

const DEFAULT_API_BASE_URL = "https://api.opensea.io"
const DEFAULT_STATEMENT =
  "Click to sign in and accept the Platform Terms of Service (https://opensea.io/tos) and Privacy Policy (https://opensea.io/privacy)."

export type ChainArch = "EVM" | "SVM" | "BITCOIN"
export type AccountType = "Ethereum" | "Solana" | "Bitcoin"

export interface CreateSiwxMessageOptions {
  address: string
  chainId: number
  nonce: string
  domain?: string
  uri?: string
  version?: "1"
  statement?: string
  issuedAt?: Date
  expirationTime?: Date
  notBefore?: Date
  requestId?: string
  resources?: string[]
  scheme?: string
  chainArch?: ChainArch
  accountType?: AccountType
}

export interface ParseSiwxMessageResult {
  domain: string
  address: string
  statement: string
  uri: string
  version: string
  chainId: string
  nonce: string
  issuedAt: string
  expirationTime?: string
  notBefore?: string
  requestId?: string
  resources?: string[]
  accountType?: AccountType
}

export interface LinkWalletWithSiwxOptions
  extends Omit<CreateSiwxMessageOptions, "address" | "chainId" | "nonce"> {
  /** @deprecated Nonces now come from apiBaseUrl. */
  authBaseUrl?: string
  apiBaseUrl?: string
  apiKey?: string
  authToken: string
  chainArch: ChainArch
  chainId: number
  /**
   * Transport used for the nonce request and the link request, defaulting to the global `fetch`.
   * Same seam as {@link OpenSeaAPIConfig.fetch}.
   *
   * It sees the auth token, the API key and the wallet signature, so anything it logs or caches
   * is sensitive.
   */
  fetch?: FetchImpl
}

const DOMAIN_REGEX =
  /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(:[0-9]{1,5})?$/
const IP_REGEX =
  /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(:[0-9]{1,5})?$/
const LOCALHOST_REGEX = /^localhost(:[0-9]{1,5})?$/
const NONCE_REGEX = /^[a-zA-Z0-9]{8,}$/
const SCHEME_REGEX = /^([a-zA-Z][a-zA-Z0-9+-.]*)$/
const WHITESPACE_REGEX = /\s/
const FIELD_PREFIXES = {
  uri: "URI: ",
  version: "Version: ",
  chainId: "Chain ID: ",
  nonce: "Nonce: ",
  issuedAt: "Issued At: ",
  expirationTime: "Expiration Time: ",
  notBefore: "Not Before: ",
  requestId: "Request ID: ",
} as const

type FieldKey = keyof typeof FIELD_PREFIXES

/**
 * Translate a chain architecture to the SIWX account type prefix.
 */
export function chainArchToAccountType(
  chainArch: ChainArch,
): AccountType | undefined {
  switch (chainArch) {
    case "EVM":
      return "Ethereum"
    case "SVM":
      return "Solana"
    case "BITCOIN":
      return "Bitcoin"
  }
}

/**
 * Build an EIP-4361/SIWX message for OpenSea wallet linking.
 */
export function createSiwxMessage(options: CreateSiwxMessageOptions): string {
  const accountType =
    options.accountType ??
    (options.chainArch ? chainArchToAccountType(options.chainArch) : undefined)
  const {
    address,
    chainId,
    domain = "opensea.io",
    expirationTime,
    issuedAt = new Date(),
    nonce,
    notBefore,
    requestId,
    resources,
    scheme,
    uri = "https://opensea.io",
    version = "1",
  } = options

  validateFields({
    chainId,
    domain,
    nonce,
    scheme,
    statement: options.statement,
    uri,
    version,
    requestId,
    resources,
  })

  const formattedAddress =
    accountType === "Ethereum" ? getAddress(address) : address
  const origin = scheme ? `${scheme}://${domain}` : domain
  const statement = options.statement ? `${options.statement}\n` : ""
  const accountTypePrefix = accountType ? `${accountType} ` : ""
  const prefix = `${origin} wants you to sign in with your ${accountTypePrefix}account:\n${formattedAddress}\n\n${statement}`

  let suffix = `URI: ${uri}\nVersion: ${version}\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt.toISOString()}`
  if (expirationTime) {
    suffix += `\nExpiration Time: ${expirationTime.toISOString()}`
  }
  if (notBefore) {
    suffix += `\nNot Before: ${notBefore.toISOString()}`
  }
  if (requestId) {
    suffix += `\nRequest ID: ${requestId}`
  }
  if (resources && resources.length > 0) {
    suffix += "\nResources:"
    for (const resource of resources) {
      suffix += `\n- ${resource}`
    }
  }

  return `${prefix}\n${suffix}`
}

/**
 * Parse a SIWX message into the JSON body expected by the wallet-link API.
 */
export function parseSiwxMessage(message: string): ParseSiwxMessageResult {
  const lines = message.split("\n")
  const domainMatch =
    /^(?<domain>[^ ]+) wants you to sign in with your (?:(?<accountType>Ethereum|Solana|Bitcoin) )?account:$/.exec(
      lines[0] ?? "",
    )
  const addressMatch = /^(?<address>.+)$/.exec(lines[1] ?? "")
  if (!domainMatch || !addressMatch) {
    throw new Error("Invalid SIWX message")
  }
  if (domainMatch.groups == null || addressMatch.groups == null) {
    throw new Error("Invalid SIWX message")
  }
  const { domain, accountType } = domainMatch.groups
  const { address } = addressMatch.groups

  const fields: Record<FieldKey, string> = {
    uri: "",
    version: "",
    chainId: "",
    nonce: "",
    issuedAt: "",
    expirationTime: "",
    notBefore: "",
    requestId: "",
  }
  const resources: string[] = []

  let firstFieldLineIndex = lines.length
  for (let i = 2; i < lines.length; i += 1) {
    const line = lines[i]
    for (const key of Object.keys(FIELD_PREFIXES) as FieldKey[]) {
      const prefix = FIELD_PREFIXES[key]
      if (fields[key] === "" && line.startsWith(prefix)) {
        fields[key] = line.slice(prefix.length)
        firstFieldLineIndex = Math.min(firstFieldLineIndex, i)
      }
    }
    if (line === "Resources:") {
      firstFieldLineIndex = Math.min(firstFieldLineIndex, i)
      for (let j = i + 1; j < lines.length; j += 1) {
        const resourceLine = lines[j]
        if (resourceLine.startsWith("- ")) {
          resources.push(resourceLine.slice(2))
        }
      }
      break
    }
  }

  const statementLines = lines.slice(2, firstFieldLineIndex)
  while (statementLines.length > 0 && statementLines[0] === "") {
    statementLines.shift()
  }
  while (statementLines.length > 0 && statementLines.at(-1) === "") {
    statementLines.pop()
  }

  return {
    domain,
    address,
    statement: statementLines.join("\n"),
    uri: fields.uri,
    version: fields.version,
    chainId: fields.chainId,
    nonce: fields.nonce,
    issuedAt: fields.issuedAt,
    ...(fields.expirationTime
      ? {
          expirationTime: fields.expirationTime,
        }
      : {}),
    ...(fields.notBefore
      ? {
          notBefore: fields.notBefore,
        }
      : {}),
    ...(fields.requestId
      ? {
          requestId: fields.requestId,
        }
      : {}),
    ...(resources.length > 0
      ? {
          resources,
        }
      : {}),
    ...(accountType
      ? {
          accountType: accountType as AccountType,
        }
      : {}),
  }
}

/**
 * Request a single-use nonce from the OpenSea API.
 *
 * @param apiBaseUrl Base URL to request the nonce from. Defaults to mainnet.
 * @param options Optional `fetch` transport, defaulting to the global `fetch`. Same seam as
 *                {@link OpenSeaAPIConfig.fetch}, for a caller routing every request through
 *                its own transport.
 */
export async function requestSiwxNonce(
  apiBaseUrl = DEFAULT_API_BASE_URL,
  options: { fetch?: FetchImpl } = {},
): Promise<string> {
  const response = await fetchWith(
    options.fetch,
    `${stripTrailingSlash(apiBaseUrl)}/api/v2/auth/siwe/nonce`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
  )
  if (!response.ok) {
    throw new Error(
      `Auth server error (${response.status}): ${response.statusText}`,
    )
  }
  const data = (await response.json()) as { nonce: string }
  return data.nonce
}

/**
 * Fetch, sign, and submit a wallet-link request.
 */
export async function linkWalletWithSiwx(
  signer: AuthSigner,
  options: LinkWalletWithSiwxOptions,
): Promise<OperationResponse<"link_wallet_with_siwx">> {
  if (
    typeof options.authToken !== "string" ||
    options.authToken.trim() === ""
  ) {
    throw new Error("authToken is required to link a wallet")
  }

  const apiBaseUrl = stripTrailingSlash(
    options.apiBaseUrl ?? DEFAULT_API_BASE_URL,
  )
  const nonce = await requestSiwxNonce(apiBaseUrl, { fetch: options.fetch })
  const address = await signer.getAddress()
  const message = createSiwxMessage({
    address,
    chainArch: options.chainArch,
    chainId: options.chainId,
    nonce,
    domain: options.domain,
    uri: options.uri,
    version: options.version,
    statement: options.statement ?? DEFAULT_STATEMENT,
    issuedAt: options.issuedAt,
    expirationTime: options.expirationTime,
    notBefore: options.notBefore,
    requestId: options.requestId,
    resources: options.resources,
    scheme: options.scheme,
  })
  const signature = await signer.signMessage(message)
  const payload: OperationRequestBody<"link_wallet_with_siwx"> = {
    message: parseSiwxMessage(message),
    signature,
    chainArch: options.chainArch,
  }

  const response = await fetchWith(
    options.fetch,
    `${apiBaseUrl}/api/v2/accounts/wallets/siwx`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.authToken}`,
        "Content-Type": "application/json",
        ...(options.apiKey ? { "X-API-KEY": options.apiKey } : {}),
      },
      body: JSON.stringify(payload),
    },
  )
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(
      `Wallet link failed (${response.status}): ${body || response.statusText}`,
    )
  }
  return response.json() as Promise<OperationResponse<"link_wallet_with_siwx">>
}

function validateFields({
  chainId,
  domain,
  nonce,
  scheme,
  statement,
  uri,
  version,
  requestId,
  resources,
}: {
  chainId: number
  domain: string
  nonce: string
  scheme?: string
  statement?: string
  uri: string
  version: string
  requestId?: string
  resources?: string[]
}) {
  if (chainId !== Math.floor(chainId)) {
    throw new Error("Chain ID must be a whole number")
  }
  if (
    !(
      DOMAIN_REGEX.test(domain) ||
      IP_REGEX.test(domain) ||
      LOCALHOST_REGEX.test(domain)
    )
  ) {
    throw new Error(`Invalid domain: ${domain}`)
  }
  if (!NONCE_REGEX.test(nonce)) {
    throw new Error(`Invalid nonce: ${nonce}`)
  }
  if (scheme && !SCHEME_REGEX.test(scheme)) {
    throw new Error(`Invalid scheme: ${scheme}`)
  }
  if (hasLineBreakOrControl(uri)) {
    throw new Error("URI must not include newlines or control characters")
  }
  if (!isUri(uri)) {
    throw new Error(`Invalid uri: ${uri}`)
  }
  if (version !== "1") {
    throw new Error(`Invalid version: ${version}`)
  }
  if (statement !== undefined && hasLineBreakOrControl(statement)) {
    throw new Error("Statement must not include newlines")
  }
  if (requestId !== undefined && hasLineBreakOrControl(requestId)) {
    throw new Error(
      "Request ID must not include newlines or control characters",
    )
  }
  if (resources) {
    for (const resource of resources) {
      if (hasLineBreakOrControl(resource)) {
        throw new Error(
          "Resource URI must not include newlines or control characters",
        )
      }
      if (!isUri(resource)) {
        throw new Error(`Invalid resource URI: ${resource}`)
      }
    }
  }
}

/**
 * True for C0/C1 control characters (CR, LF and tab included) and the Unicode
 * line and paragraph separators, any of which can split a message line.
 */
function hasLineBreakOrControl(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029
    ) {
      return true
    }
  }
  return false
}

/**
 * `new URL()` silently strips tab/CR/LF and trims surrounding whitespace, so
 * the raw value, which is spliced into the signed message verbatim, is checked
 * for whitespace first.
 */
function isUri(value: string): boolean {
  if (WHITESPACE_REGEX.test(value)) {
    return false
  }
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, "")
}
