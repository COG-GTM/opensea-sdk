/**
 * Checks on the fulfillment transaction the OpenSea API builds, so the SDK
 * never signs a call that does something other than fill the order the caller
 * asked for. The API response is treated as untrusted input: a compromised API,
 * proxy, or custom `fetch` must not be able to redirect funds or call another
 * Seaport function.
 */

import type { OrderComponents } from "@opensea/seaport-js/lib/types"
import { checksumAddress } from "../utils/address"
import { requireValidProtocol } from "../utils/protocol"

const ZERO_BYTES32 = `0x${"0".repeat(64)}`
const ZERO_ADDRESS = `0x${"0".repeat(40)}`

/** Seaport `ItemType` values. */
const ItemType = {
  NATIVE: 0,
  ERC20: 1,
  ERC721: 2,
  ERC1155: 3,
  ERC721_WITH_CRITERIA: 4,
  ERC1155_WITH_CRITERIA: 5,
} as const

/** The Seaport fulfill functions the API may name, mapped to their ABI name. */
const ALLOWED_FULFILL_FUNCTIONS: Record<string, string> = {
  fulfillBasicOrder: "fulfillBasicOrder",
  fulfillBasicOrder_efficient_6GL6yc: "fulfillBasicOrder",
  fulfillOrder: "fulfillOrder",
  fulfillAdvancedOrder: "fulfillAdvancedOrder",
}

type ItemLike = {
  itemType: number
  token: string
  identifierOrCriteria: string
  startAmount: string
  endAmount: string
}
type ConsiderationItemLike = ItemLike & { recipient: string }

/** Seaport `OrderParameters`: the hashed order fields plus any appended tips. */
export type FulfilledOrderParameters = {
  offerer: string
  zone: string
  offer: ItemLike[]
  consideration: ConsiderationItemLike[]
  orderType: number
  startTime: string
  endTime: string
  zoneHash: string
  salt: string
  conduitKey: string
  totalOriginalConsiderationItems: number
}

export type ParsedFulfillmentCall = {
  /** Seaport ABI function name to encode. */
  functionName: string
  /** Arguments in ABI order. */
  params: unknown[]
  /** The order being filled, as Seaport will see it. */
  orderParameters: FulfilledOrderParameters
  /** `recipient` argument of `fulfillAdvancedOrder`, if any. */
  recipient?: string
  /** `criteriaResolvers` argument of `fulfillAdvancedOrder`. */
  criteriaResolvers: unknown[]
  /** Fraction of the order filled; 1/1 for everything but `fulfillAdvancedOrder`. */
  numerator: bigint
  denominator: bigint
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function fail(message: string): never {
  throw new Error(`Rejected fulfillment data from the API: ${message}`)
}

function toBigIntStrict(value: unknown, field: string): bigint {
  if (typeof value === "bigint") {
    return value
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value)
  }
  if (typeof value === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(value)) {
    return BigInt(value)
  }
  return fail(`${field} is not an unsigned integer`)
}

function toStringField(value: unknown, field: string): string {
  if (typeof value !== "string") {
    fail(`${field} is missing`)
  }
  return value
}

function toItemType(value: unknown, field: string): number {
  const itemType = Number(toBigIntStrict(value, field))
  if (itemType > 5) {
    fail(`${field} is not a Seaport item type`)
  }
  return itemType
}

function parseItem(raw: unknown, field: string): ItemLike {
  if (!isRecord(raw)) {
    fail(`${field} is not an item`)
  }
  return {
    itemType: toItemType(raw.itemType, `${field}.itemType`),
    token: toStringField(raw.token, `${field}.token`),
    identifierOrCriteria: toBigIntStrict(
      raw.identifierOrCriteria,
      `${field}.identifierOrCriteria`,
    ).toString(),
    startAmount: toBigIntStrict(
      raw.startAmount,
      `${field}.startAmount`,
    ).toString(),
    endAmount: toBigIntStrict(raw.endAmount, `${field}.endAmount`).toString(),
  }
}

function parseOrderParameters(raw: unknown): FulfilledOrderParameters {
  if (!isRecord(raw)) {
    fail("order parameters are missing")
  }
  if (!Array.isArray(raw.offer) || !Array.isArray(raw.consideration)) {
    fail("order parameters have no offer or consideration")
  }
  return {
    offerer: toStringField(raw.offerer, "offerer"),
    zone: toStringField(raw.zone, "zone"),
    offer: raw.offer.map((item, i) => parseItem(item, `offer[${i}]`)),
    consideration: raw.consideration.map((item, i) => ({
      ...parseItem(item, `consideration[${i}]`),
      recipient: toStringField(
        isRecord(item) ? item.recipient : undefined,
        `consideration[${i}].recipient`,
      ),
    })),
    orderType: Number(toBigIntStrict(raw.orderType, "orderType")),
    startTime: toBigIntStrict(raw.startTime, "startTime").toString(),
    endTime: toBigIntStrict(raw.endTime, "endTime").toString(),
    zoneHash: toStringField(raw.zoneHash, "zoneHash"),
    salt: toBigIntStrict(raw.salt, "salt").toString(),
    conduitKey: toStringField(raw.conduitKey, "conduitKey"),
    totalOriginalConsiderationItems: Number(
      toBigIntStrict(
        raw.totalOriginalConsiderationItems,
        "totalOriginalConsiderationItems",
      ),
    ),
  }
}

/**
 * Rebuild the order Seaport derives from `BasicOrderParameters`, following
 * Seaport's `BasicOrderFulfiller`: `basicOrderType = route * 4 + orderType`,
 * the first consideration item goes to the offerer, and each additional
 * recipient is paid in the consideration token (or the offered ERC20 when the
 * fulfiller is selling an NFT into an offer).
 */
export function basicOrderToOrderParameters(
  raw: unknown,
): FulfilledOrderParameters {
  if (!isRecord(raw)) {
    fail("basic order parameters are missing")
  }
  const basicOrderType = Number(
    toBigIntStrict(raw.basicOrderType, "basicOrderType"),
  )
  const route = Math.floor(basicOrderType / 4)
  if (route > 5) {
    fail("basicOrderType is out of range")
  }
  const offerer = toStringField(raw.offerer, "offerer")
  const offerToken = toStringField(raw.offerToken, "offerToken")
  const considerationToken = toStringField(
    raw.considerationToken,
    "considerationToken",
  )

  const [offeredItemType, receivedItemType] = (
    [
      [ItemType.ERC721, ItemType.NATIVE],
      [ItemType.ERC1155, ItemType.NATIVE],
      [ItemType.ERC721, ItemType.ERC20],
      [ItemType.ERC1155, ItemType.ERC20],
      [ItemType.ERC20, ItemType.ERC721],
      [ItemType.ERC20, ItemType.ERC1155],
    ] as const
  )[route]
  const sellingIntoOffer = route >= 4
  const additionalItemType = sellingIntoOffer
    ? offeredItemType
    : receivedItemType
  const additionalToken = sellingIntoOffer ? offerToken : considerationToken

  const offerAmount = toBigIntStrict(raw.offerAmount, "offerAmount").toString()
  const considerationAmount = toBigIntStrict(
    raw.considerationAmount,
    "considerationAmount",
  ).toString()

  const additionalRecipients = raw.additionalRecipients ?? []
  if (!Array.isArray(additionalRecipients)) {
    fail("additionalRecipients is not an array")
  }

  return {
    offerer,
    zone: toStringField(raw.zone, "zone"),
    offer: [
      {
        itemType: offeredItemType,
        token: offerToken,
        identifierOrCriteria: toBigIntStrict(
          raw.offerIdentifier,
          "offerIdentifier",
        ).toString(),
        startAmount: offerAmount,
        endAmount: offerAmount,
      },
    ],
    consideration: [
      {
        itemType: receivedItemType,
        token: considerationToken,
        identifierOrCriteria: toBigIntStrict(
          raw.considerationIdentifier,
          "considerationIdentifier",
        ).toString(),
        startAmount: considerationAmount,
        endAmount: considerationAmount,
        recipient: offerer,
      },
      ...additionalRecipients.map((entry: unknown, i) => {
        if (!isRecord(entry)) {
          fail(`additionalRecipients[${i}] is not a recipient`)
        }
        const amount = toBigIntStrict(
          entry.amount,
          `additionalRecipients[${i}].amount`,
        ).toString()
        return {
          itemType: additionalItemType,
          token: additionalToken,
          identifierOrCriteria: "0",
          startAmount: amount,
          endAmount: amount,
          recipient: toStringField(
            entry.recipient,
            `additionalRecipients[${i}].recipient`,
          ),
        }
      }),
    ],
    orderType: basicOrderType % 4,
    startTime: toBigIntStrict(raw.startTime, "startTime").toString(),
    endTime: toBigIntStrict(raw.endTime, "endTime").toString(),
    zoneHash: toStringField(raw.zoneHash, "zoneHash"),
    salt: toBigIntStrict(raw.salt, "salt").toString(),
    conduitKey: toStringField(raw.offererConduitKey, "offererConduitKey"),
    totalOriginalConsiderationItems:
      Number(
        toBigIntStrict(
          raw.totalOriginalAdditionalRecipients,
          "totalOriginalAdditionalRecipients",
        ),
      ) + 1,
  }
}

/**
 * Map the API's `transaction.function` and `inputData` to a Seaport call.
 * Only the fulfill functions are accepted; anything else (for example
 * `incrementCounter`, `cancel`, or `matchAdvancedOrders`) throws.
 */
export function parseFulfillmentCall(
  rawFunction: unknown,
  inputData: unknown,
): ParsedFulfillmentCall {
  if (typeof rawFunction !== "string") {
    fail("transaction.function is missing")
  }
  const rawFunctionName = rawFunction.split("(")[0]
  const functionName = Object.hasOwn(ALLOWED_FULFILL_FUNCTIONS, rawFunctionName)
    ? ALLOWED_FULFILL_FUNCTIONS[rawFunctionName]
    : undefined
  if (!functionName) {
    fail(`unexpected Seaport function "${rawFunctionName}"`)
  }
  if (!isRecord(inputData)) {
    fail("transaction.inputData is missing")
  }
  const fulfillerConduitKey = inputData.fulfillerConduitKey || ZERO_BYTES32

  if (functionName === "fulfillAdvancedOrder") {
    const advancedOrder = inputData.advancedOrder
    if (!isRecord(advancedOrder)) {
      fail("advancedOrder is missing")
    }
    const criteriaResolvers = inputData.criteriaResolvers ?? []
    if (!Array.isArray(criteriaResolvers)) {
      fail("criteriaResolvers is not an array")
    }
    const recipient = toStringField(inputData.recipient, "recipient")
    const numerator = toBigIntStrict(advancedOrder.numerator, "numerator")
    const denominator = toBigIntStrict(advancedOrder.denominator, "denominator")
    if (numerator === 0n || numerator > denominator) {
      fail("advancedOrder fraction is out of range")
    }
    return {
      functionName,
      params: [
        advancedOrder,
        criteriaResolvers,
        fulfillerConduitKey,
        recipient,
      ],
      orderParameters: parseOrderParameters(advancedOrder.parameters),
      recipient,
      criteriaResolvers,
      numerator,
      denominator,
    }
  }

  if (functionName === "fulfillOrder") {
    const order = inputData.order
    if (!isRecord(order)) {
      fail("order is missing")
    }
    return {
      functionName,
      params: [order, fulfillerConduitKey],
      orderParameters: parseOrderParameters(order.parameters),
      criteriaResolvers: [],
      numerator: 1n,
      denominator: 1n,
    }
  }

  return {
    functionName,
    params: [inputData.parameters],
    orderParameters: basicOrderToOrderParameters(inputData.parameters),
    criteriaResolvers: [],
    numerator: 1n,
    denominator: 1n,
  }
}

/**
 * Require the transaction target to be a supported Seaport contract and the
 * same contract the order was signed for.
 */
export function requireFulfillmentTarget(
  to: unknown,
  protocolAddress: string,
): void {
  if (typeof to !== "string") {
    fail("transaction.to is missing")
  }
  requireValidProtocol(to)
  if (checksumAddress(to) !== checksumAddress(protocolAddress)) {
    fail(
      `transaction.to ${to} does not match the order's protocol address ${protocolAddress}`,
    )
  }
}

/** The signed `OrderComponents` for the parameters, i.e. without tips. */
export function toOrderComponents(
  parameters: FulfilledOrderParameters,
  counter: string,
): OrderComponents {
  const { totalOriginalConsiderationItems, ...rest } = parameters
  return {
    ...rest,
    consideration: parameters.consideration.slice(
      0,
      totalOriginalConsiderationItems,
    ),
    totalOriginalConsiderationItems,
    counter,
  } as OrderComponents
}

/**
 * Upper bound on the native currency the fulfiller pays for the filled
 * fraction: every native consideration item at the larger of its start and end
 * amounts, scaled by `numerator / denominator` and rounded up. Tips (items past
 * `totalOriginalConsiderationItems`) count only when `includeTips` is set.
 */
export function maxNativePayment(
  parameters: FulfilledOrderParameters,
  includeTips: boolean,
  numerator = 1n,
  denominator = 1n,
): bigint {
  const items = includeTips
    ? parameters.consideration
    : parameters.consideration.slice(
        0,
        parameters.totalOriginalConsiderationItems,
      )
  let total = 0n
  for (const item of items) {
    if (item.itemType === ItemType.NATIVE) {
      total += maxAmount(item)
    }
  }
  return (total * numerator + denominator - 1n) / denominator
}

/**
 * Optional creator fees are appended to the signed order as tips, which Seaport
 * collects from the fulfiller without any signature. Cap them so the API cannot
 * use a tip to take more than this share of the order's price.
 */
export const MAX_TIP_BASIS_POINTS = 1000n

/**
 * Require any tips to be paid in a currency the order already uses (native or
 * one of its ERC20s), and to total at most {@link MAX_TIP_BASIS_POINTS} of the
 * order's amount in that currency.
 */
export function requireTipsWithinCap(
  parameters: FulfilledOrderParameters,
): void {
  const signed = parameters.consideration.slice(
    0,
    parameters.totalOriginalConsiderationItems,
  )
  const tips = parameters.consideration.slice(
    parameters.totalOriginalConsiderationItems,
  )
  const currencyKey = (item: ItemLike) =>
    `${item.itemType}:${item.token.toLowerCase()}`
  const isCurrency = (item: ItemLike) =>
    item.itemType === ItemType.NATIVE || item.itemType === ItemType.ERC20

  const orderAmounts = new Map<string, bigint>()
  for (const item of [...parameters.offer, ...signed]) {
    if (isCurrency(item)) {
      const key = currencyKey(item)
      orderAmounts.set(key, (orderAmounts.get(key) ?? 0n) + maxAmount(item))
    }
  }

  const tipAmounts = new Map<string, bigint>()
  for (const tip of tips) {
    const key = currencyKey(tip)
    if (!isCurrency(tip) || !orderAmounts.has(key)) {
      fail(`tip of ${tip.token} is not in the order's payment currency`)
    }
    tipAmounts.set(key, (tipAmounts.get(key) ?? 0n) + maxAmount(tip))
  }
  for (const [key, tipTotal] of tipAmounts) {
    const cap = ((orderAmounts.get(key) ?? 0n) * MAX_TIP_BASIS_POINTS) / 10_000n
    if (tipTotal > cap) {
      fail(`tips of ${tipTotal} exceed the cap of ${cap}`)
    }
  }
}

/**
 * Require the filled fraction to cover at most `unitsToFill` units of the
 * order's NFTs, so a response cannot fill (and transfer) more than asked.
 */
export function requireFillWithinUnits(
  parameters: FulfilledOrderParameters,
  numerator: bigint,
  denominator: bigint,
  unitsToFill: bigint,
): void {
  const nftItems = [
    ...parameters.offer,
    ...parameters.consideration.slice(
      0,
      parameters.totalOriginalConsiderationItems,
    ),
  ].filter(item => item.itemType >= ItemType.ERC721)
  if (nftItems.length === 0) {
    return
  }
  let totalUnits = minAmount(nftItems[0])
  for (const item of nftItems) {
    const amount = minAmount(item)
    if (amount < totalUnits) {
      totalUnits = amount
    }
  }
  if (numerator * totalUnits > unitsToFill * denominator) {
    fail(
      `fills ${numerator}/${denominator} of ${totalUnits} units, more than the ${unitsToFill} requested`,
    )
  }
}

/**
 * Require each criteria resolver to pick `tokenId` from a criteria item of
 * this order on `assetContractAddress`, whichever of the two the caller set.
 */
export function requireCriteriaResolversMatch(
  parameters: FulfilledOrderParameters,
  criteriaResolvers: unknown[],
  tokenId: string | undefined,
  assetContractAddress: string | undefined,
): void {
  criteriaResolvers.forEach((resolver, i) => {
    if (!isRecord(resolver)) {
      fail(`criteriaResolvers[${i}] is not a resolver`)
    }
    const field = `criteriaResolvers[${i}]`
    if (toBigIntStrict(resolver.orderIndex, `${field}.orderIndex`) !== 0n) {
      fail(`${field} does not resolve the requested order`)
    }
    const side = toBigIntStrict(resolver.side, `${field}.side`)
    const index = Number(toBigIntStrict(resolver.index, `${field}.index`))
    const items =
      side === 0n
        ? parameters.offer
        : side === 1n
          ? parameters.consideration
          : fail(`${field}.side is out of range`)
    const item = items[index]
    if (
      item === undefined ||
      (item.itemType !== ItemType.ERC721_WITH_CRITERIA &&
        item.itemType !== ItemType.ERC1155_WITH_CRITERIA)
    ) {
      fail(`${field} does not point at a criteria item`)
    }
    if (
      assetContractAddress !== undefined &&
      !isSameAddress(item.token, assetContractAddress)
    ) {
      fail(`${field} resolves ${item.token}, not ${assetContractAddress}`)
    }
    if (
      tokenId !== undefined &&
      toBigIntStrict(resolver.identifier, `${field}.identifier`) !==
        BigInt(tokenId)
    ) {
      fail(`${field} identifier does not match token ${tokenId}`)
    }
  })
}

function maxAmount(item: ItemLike): bigint {
  const start = BigInt(item.startAmount)
  const end = BigInt(item.endAmount)
  return start > end ? start : end
}

function minAmount(item: ItemLike): bigint {
  const start = BigInt(item.startAmount)
  const end = BigInt(item.endAmount)
  return start < end ? start : end
}

export function isSameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export const isZeroAddress = (address: string): boolean =>
  isSameAddress(address, ZERO_ADDRESS)

export { fail as rejectFulfillmentData }
