/**
 * Checks on the transaction the fulfillment API builds, run before the SDK
 * signs and sends it.
 *
 * {@link FulfillmentManager.fulfillOrder} sends whatever contract address,
 * native value and Seaport call the API returns, so these helpers treat the
 * response as untrusted and confirm it fills the order the caller asked to fill,
 * through a supported Seaport contract, for no more than that order costs.
 */
import { EIP_712_ORDER_TYPE } from "@opensea/seaport-js/lib/constants"
import { TypedDataEncoder } from "ethers"
import { checksumAddress } from "../utils/address"
import { isValidProtocol } from "../utils/protocol"
import { toBigInt, ZERO_CONDUIT_KEY } from "./erc20Fulfillment"

/** The API's alias for `fulfillBasicOrder`; it shares the same calldata. */
export const FULFILL_BASIC_ORDER_ALIAS = "fulfillBasicOrder_efficient_6GL6yc"

/** Seaport calls that fill one order and that the SDK knows how to check. */
export const ALLOWED_FULFILLMENT_FUNCTIONS = new Set([
  "fulfillBasicOrder",
  FULFILL_BASIC_ORDER_ALIAS,
  "fulfillOrder",
  "fulfillAdvancedOrder",
])

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

const ITEM_TYPE_NATIVE = 0
const ITEM_TYPE_ERC20 = 1
const ITEM_TYPE_ERC721 = 2
const ITEM_TYPE_ERC1155 = 3

type Item = {
  itemType: number
  token: string
  identifierOrCriteria: bigint
  startAmount: bigint
  endAmount: bigint
}

type ConsiderationItem = Item & { recipient: string }

/** A single order decoded from the API's input data, with the hashed and tip items split. */
export type FulfillmentOrder = {
  offerer: string
  zone: string
  offer: Item[]
  /** Consideration items covered by the order hash. */
  consideration: ConsiderationItem[]
  /** Consideration items the fulfiller adds on top of the signed order. */
  tips: ConsiderationItem[]
  orderType: number
  startTime: bigint
  endTime: bigint
  zoneHash: string
  salt: bigint
  conduitKey: string
}

/** A Seaport call decoded from the API's fulfillment response. */
export type FulfillmentCall = {
  /** Name to encode against the Seaport ABI. */
  functionName: "fulfillBasicOrder" | "fulfillOrder" | "fulfillAdvancedOrder"
  /** Encoding arguments, in ABI order. */
  args: unknown[]
  order: FulfillmentOrder
  /** Address receiving the offer items; `ZERO_ADDRESS` means the caller. */
  recipient: string
  criteriaResolvers: unknown[]
}

function fail(message: string): never {
  throw new Error(`Refusing to send fulfillment transaction: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(`${field} is missing or not an object`)
  }
  return value
}

function requireUint(value: unknown, field: string): bigint {
  const parsed = toBigInt(value)
  if (parsed === null) {
    fail(`${field} is not an unsigned integer`)
  }
  return parsed
}

function requireAddress(value: unknown, field: string): string {
  if (typeof value !== "string") {
    fail(`${field} is not an address`)
  }
  try {
    return checksumAddress(value)
  } catch {
    fail(`${field} is not a valid address: ${value}`)
  }
}

function requireBytes32(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    fail(`${field} is not a bytes32 value`)
  }
  return value.toLowerCase()
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function parseItem(value: unknown, field: string): Item {
  const item = requireRecord(value, field)
  return {
    itemType: Number(requireUint(item.itemType, `${field}.itemType`)),
    token: requireAddress(item.token, `${field}.token`),
    identifierOrCriteria: requireUint(
      item.identifierOrCriteria,
      `${field}.identifierOrCriteria`,
    ),
    startAmount: requireUint(item.startAmount, `${field}.startAmount`),
    endAmount: requireUint(item.endAmount, `${field}.endAmount`),
  }
}

function parseConsiderationItem(
  value: unknown,
  field: string,
): ConsiderationItem {
  const item = requireRecord(value, field)
  return {
    ...parseItem(item, field),
    recipient: requireAddress(item.recipient, `${field}.recipient`),
  }
}

/** Decode `OrderParameters` as passed to `fulfillOrder` / `fulfillAdvancedOrder`. */
function parseOrderParameters(value: unknown): FulfillmentOrder {
  const parameters = requireRecord(value, "order parameters")
  if (!Array.isArray(parameters.offer)) {
    fail("order parameters.offer is not an array")
  }
  if (!Array.isArray(parameters.consideration)) {
    fail("order parameters.consideration is not an array")
  }
  const consideration = parameters.consideration.map((item, i) =>
    parseConsiderationItem(item, `consideration[${i}]`),
  )
  const totalOriginal = Number(
    requireUint(
      parameters.totalOriginalConsiderationItems,
      "totalOriginalConsiderationItems",
    ),
  )
  if (totalOriginal > consideration.length) {
    fail(
      `totalOriginalConsiderationItems (${totalOriginal}) exceeds the ${consideration.length} consideration items`,
    )
  }
  return {
    offerer: requireAddress(parameters.offerer, "offerer"),
    zone: requireAddress(parameters.zone, "zone"),
    offer: parameters.offer.map((item, i) => parseItem(item, `offer[${i}]`)),
    consideration: consideration.slice(0, totalOriginal),
    tips: consideration.slice(totalOriginal),
    orderType: Number(requireUint(parameters.orderType, "orderType")),
    startTime: requireUint(parameters.startTime, "startTime"),
    endTime: requireUint(parameters.endTime, "endTime"),
    zoneHash: requireBytes32(parameters.zoneHash, "zoneHash"),
    salt: requireUint(parameters.salt, "salt"),
    conduitKey: requireBytes32(parameters.conduitKey, "conduitKey"),
  }
}

/**
 * Rebuild the order a `fulfillBasicOrder` call fills, the same way Seaport
 * derives it onchain, so it can be hashed and priced like any other order.
 */
function parseBasicOrderParameters(value: unknown): FulfillmentOrder {
  const p = requireRecord(value, "basic order parameters")
  const basicOrderType = Number(requireUint(p.basicOrderType, "basicOrderType"))
  const route = Math.floor(basicOrderType / 4)
  if (route > 5) {
    fail(`unknown basicOrderType ${basicOrderType}`)
  }

  // Routes 0-3 are listings paid in native (0-1) or ERC20 (2-3); routes 4-5 are
  // offers where the fulfiller sends an ERC721 (4) or ERC1155 (5) for ERC20.
  const isListing = route < 4
  const offerItemType = isListing
    ? route % 2 === 0
      ? ITEM_TYPE_ERC721
      : ITEM_TYPE_ERC1155
    : ITEM_TYPE_ERC20
  const considerationItemType = isListing
    ? route < 2
      ? ITEM_TYPE_NATIVE
      : ITEM_TYPE_ERC20
    : route === 4
      ? ITEM_TYPE_ERC721
      : ITEM_TYPE_ERC1155

  const offerer = requireAddress(p.offerer, "offerer")
  const offerToken = requireAddress(p.offerToken, "offerToken")
  const considerationToken = requireAddress(
    p.considerationToken,
    "considerationToken",
  )
  const offerAmount = requireUint(p.offerAmount, "offerAmount")
  const considerationAmount = requireUint(
    p.considerationAmount,
    "considerationAmount",
  )

  // Fee recipients are paid in the same currency as the seller: the
  // consideration currency for a listing, the offered ERC20 for an offer.
  const feeItemType = isListing ? considerationItemType : ITEM_TYPE_ERC20
  const feeToken = isListing ? considerationToken : offerToken

  const rawRecipients = p.additionalRecipients ?? []
  if (!Array.isArray(rawRecipients)) {
    fail("additionalRecipients is not an array")
  }
  const additional: ConsiderationItem[] = rawRecipients.map((raw, i) => {
    const recipient = requireRecord(raw, `additionalRecipients[${i}]`)
    const amount = requireUint(
      recipient.amount,
      `additionalRecipients[${i}].amount`,
    )
    return {
      itemType: feeItemType,
      token: feeToken,
      identifierOrCriteria: 0n,
      startAmount: amount,
      endAmount: amount,
      recipient: requireAddress(
        recipient.recipient,
        `additionalRecipients[${i}].recipient`,
      ),
    }
  })
  const totalOriginal = Number(
    requireUint(
      p.totalOriginalAdditionalRecipients,
      "totalOriginalAdditionalRecipients",
    ),
  )
  if (totalOriginal > additional.length) {
    fail(
      `totalOriginalAdditionalRecipients (${totalOriginal}) exceeds the ${additional.length} additional recipients`,
    )
  }

  return {
    offerer,
    zone: requireAddress(p.zone, "zone"),
    offer: [
      {
        itemType: offerItemType,
        token: offerToken,
        identifierOrCriteria: requireUint(p.offerIdentifier, "offerIdentifier"),
        startAmount: offerAmount,
        endAmount: offerAmount,
      },
    ],
    consideration: [
      {
        itemType: considerationItemType,
        token: considerationToken,
        identifierOrCriteria: requireUint(
          p.considerationIdentifier,
          "considerationIdentifier",
        ),
        startAmount: considerationAmount,
        endAmount: considerationAmount,
        recipient: offerer,
      },
      ...additional.slice(0, totalOriginal),
    ],
    tips: additional.slice(totalOriginal),
    orderType: basicOrderType % 4,
    startTime: requireUint(p.startTime, "startTime"),
    endTime: requireUint(p.endTime, "endTime"),
    zoneHash: requireBytes32(p.zoneHash, "zoneHash"),
    salt: requireUint(p.salt, "salt"),
    conduitKey: requireBytes32(p.offererConduitKey, "offererConduitKey"),
  }
}

/**
 * Decode the Seaport call in a fulfillment response into encoding arguments
 * plus the order it fills. Throws for any function outside
 * {@link ALLOWED_FULFILLMENT_FUNCTIONS} or any input data that does not match
 * the function's shape.
 */
export function parseFulfillmentCall(
  rawFunction: unknown,
  inputData: unknown,
): FulfillmentCall {
  if (typeof rawFunction !== "string") {
    fail("transaction.function is missing")
  }
  const rawFunctionName = rawFunction.split("(")[0]
  if (!ALLOWED_FULFILLMENT_FUNCTIONS.has(rawFunctionName)) {
    fail(`unsupported Seaport function ${rawFunctionName}`)
  }
  const data = requireRecord(inputData, "transaction.inputData")

  if (rawFunctionName === "fulfillAdvancedOrder") {
    const advancedOrder = requireRecord(data.advancedOrder, "advancedOrder")
    const criteriaResolvers = data.criteriaResolvers ?? []
    if (!Array.isArray(criteriaResolvers)) {
      fail("criteriaResolvers is not an array")
    }
    const recipient =
      data.recipient === undefined
        ? ZERO_ADDRESS
        : requireAddress(data.recipient, "recipient")
    return {
      functionName: "fulfillAdvancedOrder",
      args: [
        advancedOrder,
        criteriaResolvers,
        data.fulfillerConduitKey || ZERO_CONDUIT_KEY,
        recipient,
      ],
      order: parseOrderParameters(advancedOrder.parameters),
      recipient,
      criteriaResolvers,
    }
  }

  if (rawFunctionName === "fulfillOrder") {
    const order = requireRecord(data.order, "order")
    return {
      functionName: "fulfillOrder",
      args: [order, data.fulfillerConduitKey || ZERO_CONDUIT_KEY],
      order: parseOrderParameters(order.parameters),
      recipient: ZERO_ADDRESS,
      criteriaResolvers: [],
    }
  }

  return {
    functionName: "fulfillBasicOrder",
    args: [data.parameters],
    order: parseBasicOrderParameters(data.parameters),
    recipient: ZERO_ADDRESS,
    criteriaResolvers: [],
  }
}

/**
 * Require the transaction target to be a supported Seaport contract and the
 * same one the order was created on.
 */
export function requireTransactionTarget(
  to: unknown,
  protocolAddress: string,
): string {
  const target = requireAddress(to, "transaction.to")
  if (!isValidProtocol(target)) {
    fail(`transaction.to ${target} is not a supported Seaport contract`)
  }
  if (!sameAddress(target, protocolAddress)) {
    fail(
      `transaction.to ${target} does not match the order's protocol address ${protocolAddress}`,
    )
  }
  return target
}

/**
 * Seaport's order hash (the `OrderComponents` struct hash) for a decoded order
 * and the offerer's counter.
 */
export function computeOrderHash(
  order: FulfillmentOrder,
  counter: bigint,
): string {
  return TypedDataEncoder.hashStruct("OrderComponents", EIP_712_ORDER_TYPE, {
    offerer: order.offerer,
    zone: order.zone,
    offer: order.offer,
    consideration: order.consideration,
    orderType: order.orderType,
    startTime: order.startTime,
    endTime: order.endTime,
    zoneHash: order.zoneHash,
    salt: order.salt,
    conduitKey: order.conduitKey,
    counter,
  })
}

/**
 * Check that a decoded call fills the order the caller asked for, on the
 * caller's behalf, and spends no more native currency than that order costs.
 */
export function requireCallMatchesOrder(
  call: FulfillmentCall,
  {
    orderHash,
    counter,
    accountAddress,
    recipientAddress,
    tokenId,
    includeOptionalCreatorFees,
    value,
  }: {
    orderHash: string
    counter: bigint
    accountAddress: string
    recipientAddress?: string
    tokenId?: string
    includeOptionalCreatorFees: boolean
    value: unknown
  },
): bigint {
  const { order } = call

  // Seaport skips the signature check when the offerer is the caller, so an
  // order naming the caller as offerer can spend the caller's approvals.
  if (sameAddress(order.offerer, accountAddress)) {
    fail("the returned order's offerer is the fulfilling account")
  }

  const computed = computeOrderHash(order, counter)
  if (computed.toLowerCase() !== orderHash.toLowerCase()) {
    fail(
      `the returned order hashes to ${computed}, not the requested order ${orderHash}`,
    )
  }

  if (!sameAddress(call.recipient, ZERO_ADDRESS)) {
    const allowed = [accountAddress, recipientAddress].filter(
      (address): address is string => !!address,
    )
    if (!allowed.some((address) => sameAddress(address, call.recipient))) {
      fail(
        `recipient ${call.recipient} is not the fulfiller or the requested recipient`,
      )
    }
  }

  if (tokenId !== undefined) {
    const wanted = requireUint(tokenId, "tokenId")
    call.criteriaResolvers.forEach((raw, i) => {
      const resolver = requireRecord(raw, `criteriaResolvers[${i}]`)
      const identifier = requireUint(
        resolver.identifier,
        `criteriaResolvers[${i}].identifier`,
      )
      if (identifier !== wanted) {
        fail(
          `criteriaResolvers[${i}] resolves token ${identifier}, not the requested token ${wanted}`,
        )
      }
    })
  }

  // Tips are paid by the fulfiller on top of the signed order. The API only
  // adds them for optional creator fees, and only in the order's own currency.
  if (order.tips.length > 0) {
    if (!includeOptionalCreatorFees) {
      fail(
        `the call adds ${order.tips.length} consideration item(s) the order does not include`,
      )
    }
    const paymentItems = order.consideration.filter(
      (item) =>
        item.itemType === ITEM_TYPE_NATIVE || item.itemType === ITEM_TYPE_ERC20,
    )
    for (const tip of order.tips) {
      const matchesCurrency = paymentItems.some(
        (item) =>
          item.itemType === tip.itemType && sameAddress(item.token, tip.token),
      )
      if (!matchesCurrency) {
        fail(
          `optional fee item pays ${tip.token} (item type ${tip.itemType}), which the order is not priced in`,
        )
      }
    }
  }

  const sendValue = requireUint(value, "transaction.value")
  let nativeTotal = 0n
  for (const item of [...order.consideration, ...order.tips]) {
    if (item.itemType === ITEM_TYPE_NATIVE) {
      nativeTotal +=
        item.startAmount > item.endAmount ? item.startAmount : item.endAmount
    }
  }
  if (sendValue > nativeTotal) {
    fail(
      `transaction.value ${sendValue} exceeds the order's native price ${nativeTotal}`,
    )
  }
  return sendValue
}
