import { describe, expect, test, vi } from "vitest"
import { ALTERNATE_SEAPORT_V1_6_ADDRESS } from "../../src/constants"
import {
  computeOrderHash,
  parseFulfillmentCall,
} from "../../src/orders/fulfillmentValidation"
import { DEFAULT_SEAPORT_CONTRACT_ADDRESS } from "../../src/orders/utils"
import { FulfillmentManager } from "../../src/sdk/fulfillment"
import { Chain, EventType } from "../../src/types"
import { createMockContext } from "../fixtures/context"
import { mockListing, mockListingPartiallyFilled } from "../fixtures/listings"
import {
  mockOfferOrderV2,
  mockOrderComponents,
  mockOrderV2,
  mockPrivateListingOrderV2,
} from "../fixtures/orders"

const SEAPORT = mockOrderV2.protocolAddress
const OTHER_SEAPORT = ALTERNATE_SEAPORT_V1_6_ADDRESS
const BUYER = "0x00000000000000000000000000000000000b0b0b"
const ATTACKER = "0x00000000000000000000000000000000deadbeef"
const SELLER = "0xfba662e1a8e91a350702cf3b87d0c2d2fb4ba57f"
const NFT = "0x88d381e3c65221abea498c69e990d1deb7bd3863"
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
const ZERO_BYTES32 = `0x${"0".repeat(64)}`
const OPENSEA_CONDUIT_KEY =
  "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000"
const PRICE = "99000000"
const ADVANCED_ORDER_FUNCTION =
  "fulfillAdvancedOrder(((address,address,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[],uint8,uint256,uint256,bytes32,uint256,bytes32,uint256),uint120,uint120,bytes,bytes),(uint256,uint8,uint256,uint256,bytes32[])[],bytes32,address)"
const FULFILL_ORDER_FUNCTION =
  "fulfillOrder(((address,address,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[],uint8,uint256,uint256,bytes32,uint256,bytes32,uint256),bytes),bytes32)"

/** Seller lists 10000 units of an ERC1155 for 99000000 wei. */
function nativeListingParameters(overrides: Record<string, unknown> = {}) {
  return {
    offerer: SELLER,
    zone: ZERO_ADDRESS,
    offer: [
      {
        itemType: 3,
        token: NFT,
        identifierOrCriteria: "1",
        startAmount: "10000",
        endAmount: "10000",
      },
    ],
    consideration: [
      {
        itemType: 0,
        token: ZERO_ADDRESS,
        identifierOrCriteria: "0",
        startAmount: PRICE,
        endAmount: PRICE,
        recipient: SELLER,
      },
    ],
    orderType: 1,
    startTime: "1759963495",
    endTime: "1775515495",
    zoneHash: ZERO_BYTES32,
    salt: "27855337018906766782546881864045825683096516384821792734247163280454785126732",
    conduitKey: OPENSEA_CONDUIT_KEY,
    totalOriginalConsiderationItems: "1",
    ...overrides,
  }
}

function advancedOrderTransaction({
  parameters = nativeListingParameters(),
  value = PRICE,
  extraData = "0x",
  recipient = ZERO_ADDRESS,
  criteriaResolvers = [] as unknown[],
  fulfillerConduitKey = ZERO_BYTES32,
  ...rest
}: {
  parameters?: Record<string, unknown>
  value?: string | number
  extraData?: string
  recipient?: string
  criteriaResolvers?: unknown[]
  fulfillerConduitKey?: string
  [key: string]: unknown
} = {}) {
  return {
    to: SEAPORT,
    value,
    function: ADVANCED_ORDER_FUNCTION,
    inputData: {
      advancedOrder: {
        parameters,
        numerator: 1,
        denominator: 1,
        signature: "0x",
        extraData,
      },
      criteriaResolvers,
      fulfillerConduitKey,
      recipient,
    },
    ...rest,
  }
}

/** ETH_TO_ERC721_FULL_OPEN basic listing: 1 ETH to the seller plus a 0.025 ETH fee. */
function basicOrderTransaction(overrides: Record<string, unknown> = {}) {
  return {
    to: SEAPORT,
    value: "1025000000000000000",
    function: "fulfillBasicOrder_efficient_6GL6yc((uint256))",
    inputData: {
      // The API names this `parameters`, not `basicOrderParameters`: it
      // serializes the decoded Seaport call, whose basic-order variant carries
      // a single `parameters` struct.
      parameters: {
        considerationToken: ZERO_ADDRESS,
        considerationIdentifier: "0",
        considerationAmount: "1000000000000000000",
        offerer: SELLER,
        zone: ZERO_ADDRESS,
        offerToken: NFT,
        offerIdentifier: "123",
        offerAmount: "1",
        basicOrderType: 0,
        startTime: "0",
        endTime: "1000000000000",
        zoneHash: ZERO_BYTES32,
        salt: "42",
        offererConduitKey: OPENSEA_CONDUIT_KEY,
        fulfillerConduitKey: ZERO_BYTES32,
        totalOriginalAdditionalRecipients: "1",
        additionalRecipients: [
          {
            amount: "25000000000000000",
            recipient: "0x0000a26b00c1f0df003000390027140000faa719",
          },
        ],
        signature: "0x",
        ...overrides,
      },
    },
  }
}

function fulfillOrderTransaction() {
  return {
    to: SEAPORT,
    value: PRICE,
    function: FULFILL_ORDER_FUNCTION,
    inputData: {
      order: { parameters: nativeListingParameters(), signature: "0x" },
      fulfillerConduitKey: ZERO_BYTES32,
      recipient: "0x000000000000000000000000000000000000beef",
    },
  }
}

/** Collection offer of 99000000 WETH-like tokens for any NFT in the collection. */
function criteriaOfferTransaction(identifiers: string[] = ["123"]) {
  return advancedOrderTransaction({
    value: "0",
    parameters: nativeListingParameters({
      offer: [
        {
          itemType: 1,
          token: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
          identifierOrCriteria: "0",
          startAmount: PRICE,
          endAmount: PRICE,
        },
      ],
      consideration: [
        {
          itemType: 4,
          token: NFT,
          identifierOrCriteria: "0",
          startAmount: "1",
          endAmount: "1",
          recipient: SELLER,
        },
      ],
    }),
    criteriaResolvers: identifiers.map((identifier) => ({
      orderIndex: 0,
      side: 1,
      index: 0,
      identifier,
      criteriaProof: [],
    })),
  })
}

/** Seaport order hash of the order a fulfillment transaction fills, at counter 0. */
function hashOf(transaction: { function: string; inputData: unknown }) {
  return computeOrderHash(
    parseFulfillmentCall(transaction.function, transaction.inputData).order,
    0n,
  )
}

describe("SDK: FulfillmentManager", () => {
  let mockOrdersManager: any
  let mockAPI: any
  let mockSeaport: any
  let mockDispatch: ReturnType<typeof vi.fn>
  let mockConfirmTransaction: ReturnType<typeof vi.fn>
  let mockRequireAccountIsAvailable: ReturnType<typeof vi.fn>
  let mockContext: ReturnType<typeof createMockContext>
  let fulfillmentManager: FulfillmentManager

  let mockTransaction: { hash: string; wait: ReturnType<typeof vi.fn> }
  let mockSigner: { sendTransaction: ReturnType<typeof vi.fn> }
  let apiTransaction: ReturnType<typeof advancedOrderTransaction> & {
    [key: string]: unknown
  }

  /** Make the mocked fulfillment API return `transaction`. */
  function respondWith(transaction: Record<string, any>) {
    apiTransaction = transaction as typeof apiTransaction
    mockAPI.generateFulfillmentData.mockResolvedValue({
      fulfillmentData: { transaction, orders: [{ signature: "0x" }] },
    })
  }

  /** `order` with the hash of the order the mocked API currently returns. */
  function orderFor<T extends { orderHash?: string | null }>(order: T): T {
    return { ...order, orderHash: hashOf(apiTransaction) }
  }

  beforeEach(() => {
    mockTransaction = {
      hash: "0xTxHash",
      wait: vi.fn().mockResolvedValue({ hash: "0xTxHash" }),
    }

    mockSigner = {
      sendTransaction: vi.fn().mockResolvedValue({ hash: "0xFulfillTxHash" }),
    }

    // Mock OrdersManager
    mockOrdersManager = {
      buildListingOrderComponents: vi
        .fn()
        .mockResolvedValue(mockOrderComponents),
      buildOfferOrderComponents: vi.fn().mockResolvedValue(mockOrderComponents),
    }

    // Mock OpenSeaAPI; respondWith() swaps the fulfillment transaction it returns
    mockAPI = { generateFulfillmentData: vi.fn() }
    respondWith(advancedOrderTransaction())

    // Mock Seaport
    mockSeaport = {
      fulfillOrder: vi.fn().mockReturnValue({
        executeAllActions: vi.fn().mockResolvedValue("0xFulfillTxHash"),
      }),
      matchOrders: vi.fn().mockReturnValue({
        transact: vi.fn().mockResolvedValue(mockTransaction),
      }),
      validate: vi.fn().mockReturnValue({
        staticCall: vi.fn().mockResolvedValue(true),
        transact: vi.fn().mockResolvedValue(mockTransaction),
      }),
    }

    // Mock callback functions
    mockDispatch = vi.fn()
    mockConfirmTransaction = vi.fn().mockResolvedValue(undefined)
    mockRequireAccountIsAvailable = vi.fn().mockResolvedValue(undefined)

    // Create SDKContext mock using fixture
    mockContext = createMockContext({
      chain: Chain.Mainnet,
      api: mockAPI,
      seaport: mockSeaport,
      dispatch: mockDispatch,
      confirmTransaction: mockConfirmTransaction,
      requireAccountIsAvailable: mockRequireAccountIsAvailable,
      wallet: { signer: mockSigner, provider: {} },
      contractCaller: {
        encodeFunctionData: vi.fn().mockReturnValue("0xEncodedData"),
        readContract: vi.fn(
          async ({ functionName }: { functionName: string }) =>
            functionName === "getCounter" ? 0n : undefined,
        ),
        writeContract: vi.fn(),
      },
    })

    // Create FulfillmentManager instance
    fulfillmentManager = new FulfillmentManager(mockContext, mockOrdersManager)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("fulfillOrder", () => {
    test("fulfills a listing order successfully", async () => {
      const result = await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOrderV2),
        accountAddress: BUYER,
      })

      expect(mockRequireAccountIsAvailable).toHaveBeenCalledTimes(1)
      expect(mockAPI.generateFulfillmentData).toHaveBeenCalledTimes(1)
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      expect(mockSigner.sendTransaction.mock.calls[0][0]).toMatchObject({
        to: SEAPORT,
        value: BigInt(PRICE),
      })
      expect(mockConfirmTransaction).toHaveBeenCalledTimes(1)
      expect(result).toBe("0xFulfillTxHash")
    })

    test("fulfills an offer order successfully", async () => {
      const result = await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOfferOrderV2),
        accountAddress: BUYER,
      })

      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      expect(result).toBe("0xFulfillTxHash")
    })

    test("fulfills criteria order with contract and tokenId", async () => {
      respondWith(criteriaOfferTransaction(["123"]))
      await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOfferOrderV2),
        accountAddress: BUYER,
        assetContractAddress: "0xNFT",
        tokenId: "123",
      })

      expect(mockAPI.generateFulfillmentData).toHaveBeenCalledTimes(1)
      const apiCall = mockAPI.generateFulfillmentData.mock.calls[0]
      expect(apiCall[4]).toBe("0xNFT")
      expect(apiCall[5]).toBe("123")
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
    })

    test("includes extraData when order has offer protection", async () => {
      respondWith(advancedOrderTransaction({ extraData: "0x1234567890abcdef" }))

      await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOrderV2),
        accountAddress: BUYER,
      })

      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      const args = (mockContext.contractCaller as any).encodeFunctionData.mock
        .calls[0][0].args
      expect(args[0].extraData).toBe("0x1234567890abcdef")
    })

    test("fulfills order with recipient address", async () => {
      const recipientAddress = "0x000000000000000000000000000000000000beef"
      respondWith(advancedOrderTransaction({ recipient: recipientAddress }))
      await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOrderV2),
        accountAddress: BUYER,
        recipientAddress,
      })

      expect(mockAPI.generateFulfillmentData).toHaveBeenCalledTimes(1)
      const apiCall = mockAPI.generateFulfillmentData.mock.calls[0]
      expect(apiCall[7]).toBe(recipientAddress)
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
    })

    test("appends the attribution suffix the API returns to the calldata", async () => {
      // Production returns calldata_suffix on every fulfillment response. The
      // SDK re-encodes the call from inputData, so it has to re-attach the
      // suffix or the fill goes onchain unattributed.
      respondWith({ ...basicOrderTransaction(), calldataSuffix: "0xcdb44011" })
      const mockContractCaller = (fulfillmentManager as any).context
        .contractCaller
      mockContractCaller.encodeFunctionData.mockReturnValue("0xdeadbeef")

      await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOrderV2),
        accountAddress: BUYER,
      })

      expect(mockSigner.sendTransaction.mock.calls[0][0].data).toBe(
        "0xdeadbeefcdb44011",
      )
    })

    test("sends the encoded calldata unchanged when the API sends no suffix", async () => {
      const mockContractCaller = (fulfillmentManager as any).context
        .contractCaller
      mockContractCaller.encodeFunctionData.mockReturnValue("0xdeadbeef")

      await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOrderV2),
        accountAddress: BUYER,
      })

      expect(mockSigner.sendTransaction.mock.calls[0][0].data).toBe(
        "0xdeadbeef",
      )
    })

    test("encodes fulfillBasicOrder alias using supported fragment", async () => {
      respondWith(basicOrderTransaction())

      const mockContractCaller = (fulfillmentManager as any).context
        .contractCaller
      mockContractCaller.encodeFunctionData.mockReturnValue("0xAliasEncoded")

      const result = await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOrderV2),
        accountAddress: BUYER,
      })

      expect(result).toBe("0xFulfillTxHash")
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      expect(
        mockContractCaller.encodeFunctionData.mock.calls[0][0],
      ).toMatchObject({ functionName: "fulfillBasicOrder" })
      expect(mockSigner.sendTransaction.mock.calls[0][0]).toMatchObject({
        to: SEAPORT,
        value: 1025000000000000000n,
        data: "0xAliasEncoded",
      })
    })

    test("encodes fulfillOrder with exactly 2 params (no recipient)", async () => {
      respondWith(fulfillOrderTransaction())

      const mockContractCaller = (fulfillmentManager as any).context
        .contractCaller
      mockContractCaller.encodeFunctionData.mockReturnValue(
        "0xFulfillOrderEncoded",
      )

      await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOrderV2),
        accountAddress: BUYER,
      })

      expect(mockContractCaller.encodeFunctionData).toHaveBeenCalledTimes(1)
      expect(
        mockContractCaller.encodeFunctionData.mock.calls[0][0],
      ).toMatchObject({ functionName: "fulfillOrder" })
      // fulfillOrder ABI only accepts 2 params: order and fulfillerConduitKey
      // recipient must NOT be passed
      const encodedArgs =
        mockContractCaller.encodeFunctionData.mock.calls[0][0].args
      expect(encodedArgs).toHaveLength(2)
    })

    test("fulfills private listing successfully", async () => {
      const result = await fulfillmentManager.fulfillOrder({
        order: mockPrivateListingOrderV2,
        accountAddress: "0xPrivateBuyer",
      })

      expect(mockSeaport.matchOrders).toHaveBeenCalledTimes(1)
      expect(mockSeaport.fulfillOrder).not.toHaveBeenCalled()
      expect(result).toBe("0xTxHash")
    })

    test("throws when account is not available", async () => {
      mockRequireAccountIsAvailable.mockRejectedValue(
        new Error("Account not available"),
      )

      await expect(
        fulfillmentManager.fulfillOrder({
          order: orderFor(mockOrderV2),
          accountAddress: BUYER,
        }),
      ).rejects.toThrow("Account not available")
    })

    test("throws when protocol is invalid", async () => {
      const invalidOrder = {
        ...orderFor(mockOrderV2),
        protocolAddress: "0xInvalidProtocol",
      }

      await expect(
        fulfillmentManager.fulfillOrder({
          order: invalidOrder,
          accountAddress: BUYER,
        }),
      ).rejects.toThrow("Unsupported protocol")
    })

    test("handles transaction response as ContractTransactionResponse", async () => {
      const result = await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOrderV2),
        accountAddress: BUYER,
      })

      expect(result).toBe("0xFulfillTxHash")
    })
  })

  describe("fulfillOrder rejects an untrusted fulfillment response", () => {
    /** Fulfill `mockOrderV2` with its real hash and expect nothing to be sent. */
    async function expectRejected(
      transaction: Record<string, any>,
      message: string | RegExp,
      options: Record<string, unknown> = {},
      orderHash = hashOf(advancedOrderTransaction()),
    ) {
      respondWith(transaction)
      await expect(
        fulfillmentManager.fulfillOrder({
          order: { ...mockOrderV2, orderHash },
          accountAddress: BUYER,
          ...options,
        }),
      ).rejects.toThrow(message)
      expect(mockSigner.sendTransaction).not.toHaveBeenCalled()
      expect(mockConfirmTransaction).not.toHaveBeenCalled()
    }

    test("a transaction.to that is not a Seaport contract", async () => {
      await expectRejected(
        advancedOrderTransaction({ to: ATTACKER }),
        /not a supported Seaport contract/,
      )
    })

    test("a transaction.to that is not an address", async () => {
      await expectRejected(
        advancedOrderTransaction({ to: "0xSeaportAddress" }),
        /transaction.to is not a valid address/,
      )
    })

    test("a supported Seaport that differs from the order's protocol address", async () => {
      await expectRejected(
        advancedOrderTransaction({ to: OTHER_SEAPORT }),
        /does not match the order's protocol address/,
      )
    })

    test.each([
      "incrementCounter()",
      "cancel((address,address,(uint8,address,uint256,uint256,uint256)[])[])",
      "matchAdvancedOrders((tuple)[],(tuple)[],(tuple)[],address)",
      "matchOrders((tuple)[],(tuple)[])",
      "fulfillAvailableAdvancedOrders((tuple)[],(tuple)[],(tuple)[][],(tuple)[][],bytes32,address,uint256)",
    ])("the Seaport function %s", async (fn) => {
      await expectRejected(
        { ...advancedOrderTransaction(), function: fn },
        /unsupported Seaport function/,
      )
      expect(
        (mockContext.contractCaller as any).encodeFunctionData,
      ).not.toHaveBeenCalled()
    })

    test("an allowed function name whose input data has the wrong shape", async () => {
      await expectRejected(
        {
          ...advancedOrderTransaction(),
          function: FULFILL_ORDER_FUNCTION,
        },
        /order is missing/,
      )
    })

    test("an order that hashes differently from the one requested", async () => {
      await expectRejected(
        advancedOrderTransaction({
          parameters: nativeListingParameters({
            consideration: [
              {
                itemType: 0,
                token: ZERO_ADDRESS,
                identifierOrCriteria: "0",
                startAmount: PRICE,
                endAmount: PRICE,
                recipient: ATTACKER,
              },
            ],
          }),
        }),
        /not the requested order/,
      )
    })

    test("a basic order that hashes differently from the one requested", async () => {
      await expectRejected(
        basicOrderTransaction({ offerIdentifier: "124" }),
        /not the requested order/,
        {},
        hashOf(basicOrderTransaction()),
      )
    })

    test("an order checked against the offerer's current counter", async () => {
      ;(mockContext.contractCaller as any).readContract.mockResolvedValue(1n)
      await expectRejected(
        advancedOrderTransaction(),
        /not the requested order/,
      )
    })

    test("an order whose counter cannot be read", async () => {
      ;(mockContext.contractCaller as any).readContract.mockRejectedValue(
        new Error("RPC unavailable"),
      )
      await expectRejected(
        advancedOrderTransaction(),
        /Could not read the Seaport counter/,
      )
    })

    test("an order whose offerer is the fulfilling account", async () => {
      // Seaport skips the signature check for the caller's own orders, so this
      // would let the API spend the buyer's approved tokens.
      const ownOrder = advancedOrderTransaction({
        parameters: nativeListingParameters({ offerer: BUYER }),
      })
      await expectRejected(
        ownOrder,
        /offerer is the fulfilling account/,
        {},
        hashOf(ownOrder),
      )
    })

    test("a value larger than the order's native price", async () => {
      await expectRejected(
        advancedOrderTransaction({ value: (BigInt(PRICE) + 1n).toString() }),
        /exceeds the order's native price 99000000/,
      )
    })

    test("a value larger than a basic order's native price", async () => {
      await expectRejected(
        { ...basicOrderTransaction(), value: "2000000000000000000" },
        /exceeds the order's native price 1025000000000000000/,
        {},
        hashOf(basicOrderTransaction()),
      )
    })

    test("any native value for an ERC20-priced order", async () => {
      const erc20Order = advancedOrderTransaction({
        value: "1",
        parameters: nativeListingParameters({
          consideration: [
            {
              itemType: 1,
              token: "0x1234567890123456789012345678901234567890",
              identifierOrCriteria: "0",
              startAmount: PRICE,
              endAmount: PRICE,
              recipient: SELLER,
            },
          ],
        }),
      })
      await expectRejected(
        erc20Order,
        /exceeds the order's native price 0/,
        {},
        hashOf(erc20Order),
      )
    })

    test("a recipient other than the buyer or the requested recipient", async () => {
      await expectRejected(
        advancedOrderTransaction({ recipient: ATTACKER }),
        /recipient .* is not the fulfilling account/,
      )
    })

    test("a criteria resolver for a token other than the requested one", async () => {
      const otherToken = criteriaOfferTransaction(["456"])
      await expectRejected(
        otherToken,
        /resolves token 456, not the requested token 123/,
        { tokenId: "123" },
        hashOf(otherToken),
      )
    })

    test("a criteria order with no resolver for the requested token", async () => {
      // An unresolved criteria item would let the API pick any approved token.
      const unresolved = criteriaOfferTransaction([])
      await expectRejected(
        unresolved,
        /0 criteria resolver\(s\) for 1 criteria item\(s\)/,
        { tokenId: "123" },
        hashOf(unresolved),
      )
    })

    test("a criteria order when no tokenId was requested", async () => {
      const criteria = criteriaOfferTransaction(["123"])
      await expectRejected(
        criteria,
        /criteria items but no tokenId was requested/,
        {},
        hashOf(criteria),
      )
    })

    test("a criteria resolver that targets a non-criteria item", async () => {
      const misplaced = criteriaOfferTransaction(["123"])
      misplaced.inputData.criteriaResolvers = [
        {
          orderIndex: 0,
          side: 0,
          index: 0,
          identifier: "123",
          criteriaProof: [],
        },
      ]
      await expectRejected(
        misplaced,
        /criteriaResolvers\[0\] targets order 0 side 0 item 0, which is not an unresolved criteria item/,
        { tokenId: "123" },
        hashOf(misplaced),
      )
    })

    test("criteria resolvers that resolve one item twice and leave another open", async () => {
      const base = criteriaOfferTransaction(["123"])
      const parameters = base.inputData.advancedOrder.parameters as any
      const criteriaItem = parameters.consideration[0]
      const twoItems = advancedOrderTransaction({
        value: "0",
        parameters: {
          ...parameters,
          consideration: [criteriaItem, criteriaItem],
          totalOriginalConsiderationItems: "2",
        },
        criteriaResolvers: [0, 0].map((index) => ({
          orderIndex: 0,
          side: 1,
          index,
          identifier: "123",
          criteriaProof: [],
        })),
      })
      await expectRejected(
        twoItems,
        /criteriaResolvers\[1\] targets order 0 side 1 item 0, which is not an unresolved criteria item/,
        { tokenId: "123" },
        hashOf(twoItems),
      )
    })

    test("a criteria resolver for another order in the call", async () => {
      const otherOrder = criteriaOfferTransaction(["123"])
      otherOrder.inputData.criteriaResolvers = [
        {
          orderIndex: 1,
          side: 1,
          index: 0,
          identifier: "123",
          criteriaProof: [],
        },
      ]
      await expectRejected(
        otherOrder,
        /targets order 1 side 1 item 0/,
        { tokenId: "123" },
        hashOf(otherOrder),
      )
    })

    test("a call that ignores the requested recipient", async () => {
      // A zero recipient delivers to the buyer, not to the requested address.
      await expectRejected(
        advancedOrderTransaction({ recipient: ZERO_ADDRESS }),
        /not the requested recipient/,
        { recipientAddress: "0x000000000000000000000000000000000000beef" },
      )
    })

    test("a basic order when a distinct recipient was requested", async () => {
      await expectRejected(
        basicOrderTransaction(),
        /not the requested recipient/,
        { recipientAddress: "0x000000000000000000000000000000000000beef" },
        hashOf(basicOrderTransaction()),
      )
    })

    test("optional fees above the cap in the order's ERC20", async () => {
      const usdc = "0x1234567890123456789012345678901234567890"
      const payment = (amount: string, recipient: string) => ({
        itemType: 1,
        token: usdc,
        identifierOrCriteria: "0",
        startAmount: amount,
        endAmount: amount,
        recipient,
      })
      const drained = advancedOrderTransaction({
        value: "0",
        parameters: nativeListingParameters({
          consideration: [
            payment(PRICE, SELLER),
            payment("1000000000000", ATTACKER),
          ],
        }),
      })
      await expectRejected(
        drained,
        /optional fees of 1000000000000 .* exceed 1000 bps/,
        { includeOptionalCreatorFees: true },
        hashOf(drained),
      )
    })

    test("optional native fees above the cap", async () => {
      const fee = (BigInt(PRICE) / 10n + 1n).toString()
      await expectRejected(
        advancedOrderTransaction({
          value: (BigInt(PRICE) + BigInt(fee)).toString(),
          parameters: nativeListingParameters({
            consideration: [
              ...nativeListingParameters().consideration,
              {
                itemType: 0,
                token: ZERO_ADDRESS,
                identifierOrCriteria: "0",
                startAmount: fee,
                endAmount: fee,
                recipient: ATTACKER,
              },
            ],
          }),
        }),
        /exceed 1000 bps of the order's price 99000000/,
        { includeOptionalCreatorFees: true },
      )
    })

    test("optional fees above the cap of a declining auction's end price", async () => {
      // 10% of the 99000000 start price, but 20% of the 49500000 end price.
      const fee = (BigInt(PRICE) / 10n).toString()
      const endPrice = (BigInt(PRICE) / 2n).toString()
      const auction = advancedOrderTransaction({
        value: (BigInt(PRICE) + BigInt(fee)).toString(),
        parameters: nativeListingParameters({
          consideration: [
            {
              ...nativeListingParameters().consideration[0],
              endAmount: endPrice,
            },
            {
              itemType: 0,
              token: ZERO_ADDRESS,
              identifierOrCriteria: "0",
              startAmount: fee,
              endAmount: fee,
              recipient: ATTACKER,
            },
          ],
        }),
      })
      await expectRejected(
        auction,
        /exceed 1000 bps of the order's price 49500000/,
        { includeOptionalCreatorFees: true },
        hashOf(auction),
      )
    })

    test("accepts optional fees within the cap of offsetting auctions", async () => {
      // One item falls 100 -> 50 while another rises 0 -> 50, so the total
      // stays 100 and a fee of 10 is within 10% throughout.
      const item = (start: string, end: string) => ({
        itemType: 0,
        token: ZERO_ADDRESS,
        identifierOrCriteria: "0",
        startAmount: start,
        endAmount: end,
        recipient: SELLER,
      })
      respondWith(
        advancedOrderTransaction({
          value: "110",
          parameters: nativeListingParameters({
            consideration: [
              item("100", "50"),
              item("0", "50"),
              item("10", "10"),
            ],
            totalOriginalConsiderationItems: "2",
          }),
        }),
      )

      await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOrderV2),
        accountAddress: BUYER,
        includeOptionalCreatorFees: true,
      })

      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
    })

    test.each(["to", "data", "value"])("overrides set %s", async (field) => {
      await expectRejected(
        advancedOrderTransaction(),
        new RegExp(`overrides cannot set ${field}`),
        { overrides: { [field]: field === "value" ? 1n : ATTACKER } },
      )
      expect(mockAPI.generateFulfillmentData).not.toHaveBeenCalled()
    })

    test("consideration items added on top of the order", async () => {
      const tipped = advancedOrderTransaction({
        value: (BigInt(PRICE) + 1000n).toString(),
        parameters: nativeListingParameters({
          consideration: [
            ...nativeListingParameters().consideration,
            {
              itemType: 0,
              token: ZERO_ADDRESS,
              identifierOrCriteria: "0",
              startAmount: "1000",
              endAmount: "1000",
              recipient: ATTACKER,
            },
          ],
        }),
      })
      await expectRejected(tipped, /does not include/)
    })

    test("an optional fee paid in a token the order is not priced in", async () => {
      const tipped = advancedOrderTransaction({
        parameters: nativeListingParameters({
          consideration: [
            ...nativeListingParameters().consideration,
            {
              itemType: 2,
              token: NFT,
              identifierOrCriteria: "7",
              startAmount: "1",
              endAmount: "1",
              recipient: ATTACKER,
            },
          ],
        }),
      })
      await expectRejected(tipped, /which the order is not priced in/, {
        includeOptionalCreatorFees: true,
      })
    })

    test("accepts an optional creator fee in the order's currency when requested", async () => {
      const creatorFee = "1000"
      respondWith(
        advancedOrderTransaction({
          value: (BigInt(PRICE) + BigInt(creatorFee)).toString(),
          parameters: nativeListingParameters({
            consideration: [
              ...nativeListingParameters().consideration,
              {
                itemType: 0,
                token: ZERO_ADDRESS,
                identifierOrCriteria: "0",
                startAmount: creatorFee,
                endAmount: creatorFee,
                recipient: "0x000000000000000000000000000000000000c0de",
              },
            ],
          }),
        }),
      )

      await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOrderV2),
        accountAddress: BUYER,
        includeOptionalCreatorFees: true,
      })

      expect(mockSigner.sendTransaction.mock.calls[0][0].value).toBe(
        BigInt(PRICE) + BigInt(creatorFee),
      )
    })

    /** The criteria offer, fulfilled for token 123, with an optional WETH fee. */
    function tippedCriteriaOffer(fee: string) {
      const base = criteriaOfferTransaction(["123"])
      const parameters = base.inputData.advancedOrder.parameters as any
      return advancedOrderTransaction({
        value: "0",
        parameters: {
          ...parameters,
          consideration: [
            ...parameters.consideration,
            {
              itemType: 1,
              token: parameters.offer[0].token,
              identifierOrCriteria: "0",
              startAmount: fee,
              endAmount: fee,
              recipient: "0x000000000000000000000000000000000000c0de",
            },
          ],
        },
        criteriaResolvers: base.inputData.criteriaResolvers,
      })
    }

    test("accepts an optional creator fee on an ERC20 offer, capped by the bid", async () => {
      respondWith(tippedCriteriaOffer((BigInt(PRICE) / 10n).toString()))

      await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOfferOrderV2),
        accountAddress: BUYER,
        tokenId: "123",
        includeOptionalCreatorFees: true,
      })

      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      expect(mockSigner.sendTransaction.mock.calls[0][0].value).toBe(0n)
    })

    test("optional fees above the cap of an ERC20 offer's bid", async () => {
      const tipped = tippedCriteriaOffer((BigInt(PRICE) / 10n + 1n).toString())
      await expectRejected(
        tipped,
        /exceed 1000 bps of the order's price 99000000/,
        { tokenId: "123", includeOptionalCreatorFees: true },
        hashOf(tipped),
      )
    })
  })

  describe("fulfillOrder with an ERC20-priced listing", () => {
    // Mainnet's default conduit, which the OpenSea API returns as the fulfiller
    // conduit key. The buyer approves this address, not Seaport.
    const CONDUIT_KEY = OPENSEA_CONDUIT_KEY
    const CONDUIT_ADDRESS = "0x1e0049783f008a0085193e00003d00cd54003c71"
    const USDG = "0x1234567890123456789012345678901234567890"

    /** Price the mock listing in USDG: 351 to the seller plus a 9 USDG fee. */
    function priceInErc20({
      fulfillerConduitKey = CONDUIT_KEY,
    }: {
      fulfillerConduitKey?: string
    } = {}) {
      respondWith(
        advancedOrderTransaction({
          value: "0",
          fulfillerConduitKey,
          recipient: BUYER,
          parameters: nativeListingParameters({
            consideration: [
              {
                itemType: 1,
                token: USDG,
                identifierOrCriteria: "0",
                startAmount: "351000000",
                endAmount: "351000000",
                recipient: SELLER,
              },
              {
                itemType: 1,
                token: USDG,
                identifierOrCriteria: "0",
                startAmount: "9000000",
                endAmount: "9000000",
                recipient: "0x0000a26b00c1f0df003000390027140000faa719",
              },
            ],
            totalOriginalConsiderationItems: "2",
          }),
        }),
      )
      return orderFor(mockOrderV2)
    }

    /** Stub balanceOf/allowance, and getConduit for a non-default conduit key. */
    function stubErc20Reads({
      balance,
      allowance,
    }: {
      balance: bigint
      allowance: bigint
    }) {
      const readContract = (
        mockContext.contractCaller as unknown as {
          readContract: ReturnType<typeof vi.fn>
        }
      ).readContract
      readContract.mockImplementation(
        async ({ functionName }: { functionName: string }) => {
          switch (functionName) {
            case "getCounter":
              return 0n
            case "balanceOf":
              return balance
            case "allowance":
              return allowance
            case "getConduit":
              return [CONDUIT_ADDRESS, true]
            default:
              throw new Error(`Unexpected read: ${functionName}`)
          }
        },
      )
      return readContract
    }

    test("submits when the buyer has balance and allowance to spare", async () => {
      const order = priceInErc20()
      stubErc20Reads({ balance: 500000000n, allowance: 360000000n })

      const result = await fulfillmentManager.fulfillOrder({
        order,
        accountAddress: BUYER,
      })

      expect(result).toBe("0xFulfillTxHash")
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      expect(mockSigner.sendTransaction.mock.calls[0][0].value).toBe(0n)
    })

    test("throws before sending when the allowance is short of the total", async () => {
      const order = priceInErc20()
      // Covers the seller's 351 but not the 9 USDG fee on top.
      stubErc20Reads({ balance: 500000000n, allowance: 351000000n })

      await expect(
        fulfillmentManager.fulfillOrder({ order, accountAddress: BUYER }),
      ).rejects.toThrow(/not approved/)
      expect(mockSigner.sendTransaction).not.toHaveBeenCalled()
    })

    test("names the conduit and the amount to approve in the error", async () => {
      const order = priceInErc20()
      stubErc20Reads({ balance: 500000000n, allowance: 0n })

      await expect(
        fulfillmentManager.fulfillOrder({ order, accountAddress: BUYER }),
      ).rejects.toThrow(`approve(${CONDUIT_ADDRESS}, 360000000)`)
    })

    test("reports insufficient balance ahead of the allowance", async () => {
      const order = priceInErc20()
      stubErc20Reads({ balance: 1n, allowance: 0n })

      await expect(
        fulfillmentManager.fulfillOrder({ order, accountAddress: BUYER }),
      ).rejects.toThrow(/Insufficient/)
      expect(mockSigner.sendTransaction).not.toHaveBeenCalled()
    })

    test("checks the allowance against Seaport for a zero conduit key", async () => {
      const order = priceInErc20({ fulfillerConduitKey: ZERO_BYTES32 })
      const readContract = stubErc20Reads({
        balance: 500000000n,
        allowance: 0n,
      })

      await expect(
        fulfillmentManager.fulfillOrder({ order, accountAddress: BUYER }),
      ).rejects.toThrow(new RegExp(`approve\\(${SEAPORT}`, "i"))

      // A zero key means Seaport transfers directly, so no conduit is resolved.
      expect(
        readContract.mock.calls.some(
          ([params]) => params.functionName === "getConduit",
        ),
      ).toBe(false)
    })

    test("resolves an unrecognized conduit key through the ConduitController", async () => {
      const order = priceInErc20({ fulfillerConduitKey: `0x${"a".repeat(64)}` })
      const readContract = stubErc20Reads({
        balance: 500000000n,
        allowance: 0n,
      })

      await expect(
        fulfillmentManager.fulfillOrder({ order, accountAddress: BUYER }),
      ).rejects.toThrow(CONDUIT_ADDRESS)

      expect(
        readContract.mock.calls.some(
          ([params]) => params.functionName === "getConduit",
        ),
      ).toBe(true)
    })

    test("submits anyway when the allowance cannot be read", async () => {
      const order = priceInErc20()
      const readContract = (
        mockContext.contractCaller as unknown as {
          readContract: ReturnType<typeof vi.fn>
        }
      ).readContract
      readContract.mockImplementation(
        async ({ functionName }: { functionName: string }) => {
          if (functionName === "getCounter") return 0n
          throw new Error("RPC unavailable")
        },
      )

      const result = await fulfillmentManager.fulfillOrder({
        order,
        accountAddress: BUYER,
      })

      // A failed preflight read must never block a purchase that would succeed.
      expect(result).toBe("0xFulfillTxHash")
    })

    test("reads only the offerer's counter for a native-priced listing", async () => {
      const readContract = (
        mockContext.contractCaller as unknown as {
          readContract: ReturnType<typeof vi.fn>
        }
      ).readContract

      await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOrderV2),
        accountAddress: BUYER,
      })

      expect(
        readContract.mock.calls.map(([params]) => params.functionName),
      ).toEqual(["getCounter"])
    })
  })

  describe("fulfillOrder with remaining_quantity", () => {
    test("defaults to 1 when unitsToFill not specified for Listing", async () => {
      await fulfillmentManager.fulfillOrder({
        order: orderFor(mockListing),
        accountAddress: BUYER,
      })

      // SDK defaults unitsToFill to "1" for both listings and offers
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      const apiCall = mockAPI.generateFulfillmentData.mock.calls[0]
      expect(apiCall[6]).toBe("1") // unitsToFill defaults to "1"
    })

    test("defaults to 1 when unitsToFill not specified for partially filled Listing", async () => {
      await fulfillmentManager.fulfillOrder({
        order: orderFor(mockListingPartiallyFilled),
        accountAddress: BUYER,
      })

      // SDK defaults unitsToFill to "1" for both listings and offers
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      const apiCall = mockAPI.generateFulfillmentData.mock.calls[0]
      expect(apiCall[6]).toBe("1") // unitsToFill defaults to "1"
    })

    test("defaults to 1 when unitsToFill not specified for OrderV2", async () => {
      await fulfillmentManager.fulfillOrder({
        order: orderFor(mockOrderV2),
        accountAddress: BUYER,
      })

      // SDK defaults unitsToFill to "1" for both listings and offers
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      const apiCall = mockAPI.generateFulfillmentData.mock.calls[0]
      expect(apiCall[6]).toBe("1") // unitsToFill defaults to "1"
    })

    test("passes unitsToFill when specified", async () => {
      const order = {
        orderHash: hashOf(apiTransaction),
        chain: "ethereum",
        protocolData: {
          parameters: mockOrderComponents,
          signature: "0xSignature",
        },
        protocolAddress: mockOrderV2.protocolAddress,
        price: {
          currency: "ETH",
          decimals: 18,
          value: "1000000000000000000",
        },
        // Set high so we can verify the explicit unitsToFill (5) is what
        // the SDK forwards to the API, not this value.
        remainingQuantity: 999,
      }

      await fulfillmentManager.fulfillOrder({
        order,
        accountAddress: BUYER,
        unitsToFill: 5,
      })

      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      const apiCall = mockAPI.generateFulfillmentData.mock.calls[0]
      expect(apiCall[6]).toBe("5") // unitsToFill passed to API
    })
  })
  describe("isOrderFulfillable", () => {
    test("returns true when order is fulfillable", async () => {
      const result = await fulfillmentManager.isOrderFulfillable({
        order: mockOrderV2,
        accountAddress: "0xBuyer",
      })

      expect(mockSeaport.validate).toHaveBeenCalledTimes(1)
      expect(result).toBe(true)
    })

    test("returns false when order is not fulfillable", async () => {
      mockSeaport.validate.mockReturnValue({
        staticCall: vi.fn().mockResolvedValue(false),
      })

      const result = await fulfillmentManager.isOrderFulfillable({
        order: mockOrderV2,
        accountAddress: "0xBuyer",
      })

      expect(result).toBe(false)
    })

    test("returns false on CALL_EXCEPTION error", async () => {
      const error = new Error("CALL_EXCEPTION") as unknown as {
        code: string
        message: string
      }
      error.code = "CALL_EXCEPTION"

      mockSeaport.validate.mockReturnValue({
        staticCall: vi.fn().mockRejectedValue(error),
      })

      const result = await fulfillmentManager.isOrderFulfillable({
        order: mockOrderV2,
        accountAddress: "0xBuyer",
      })

      expect(result).toBe(false)
    })

    test("throws other errors", async () => {
      mockSeaport.validate.mockReturnValue({
        staticCall: vi.fn().mockRejectedValue(new Error("Unknown error")),
      })

      try {
        await fulfillmentManager.isOrderFulfillable({
          order: mockOrderV2,
          accountAddress: "0xBuyer",
        })
        throw new Error("Expected error to be thrown")
      } catch (error) {
        expect((error as Error).message).toContain("Unknown error")
      }
    })

    test("throws when protocol is invalid", async () => {
      const invalidOrder = {
        ...mockOrderV2,
        protocolAddress: "0xInvalidProtocol",
      }

      try {
        await fulfillmentManager.isOrderFulfillable({
          order: invalidOrder,
          accountAddress: "0xBuyer",
        })
        throw new Error("Expected error to be thrown")
      } catch (error) {
        expect((error as Error).message).toContain("Unsupported protocol")
      }
    })
  })

  describe("approveOrder", () => {
    test("approves an order successfully", async () => {
      const result = await fulfillmentManager.approveOrder(mockOrderV2)

      expect(mockRequireAccountIsAvailable).toHaveBeenCalledTimes(1)
      expect(mockDispatch).toHaveBeenCalledTimes(1)
      expect(mockDispatch.mock.calls[0][0]).toBe(EventType.ApproveOrder)
      expect(mockSeaport.validate).toHaveBeenCalledTimes(1)
      expect(mockConfirmTransaction).toHaveBeenCalledTimes(1)
      expect(result).toBe("0xTxHash")
    })

    test("approves order with domain", async () => {
      await fulfillmentManager.approveOrder(mockOrderV2, "opensea.io")

      const validateCall = mockSeaport.validate.mock.calls[0]
      expect(validateCall[2]).toBe("opensea.io")
    })

    test("dispatches ApproveOrder event", async () => {
      await fulfillmentManager.approveOrder(mockOrderV2)

      expect(mockDispatch).toHaveBeenCalledTimes(1)
      const eventData = mockDispatch.mock.calls[0][1]
      expect(eventData.orderV2).toBe(mockOrderV2)
      expect(eventData.accountAddress).toBe("0xMaker")
    })

    test("throws when account is not available", async () => {
      mockRequireAccountIsAvailable.mockRejectedValue(
        new Error("Account not available"),
      )

      try {
        await fulfillmentManager.approveOrder(mockOrderV2)
        throw new Error("Expected error to be thrown")
      } catch (error) {
        expect((error as Error).message).toContain("Account not available")
      }
    })

    test("throws when protocol is invalid", async () => {
      const invalidOrder = {
        ...mockOrderV2,
        protocolAddress: "0xInvalidProtocol",
      }

      try {
        await fulfillmentManager.approveOrder(invalidOrder)
        throw new Error("Expected error to be thrown")
      } catch (error) {
        expect((error as Error).message).toContain("Unsupported protocol")
      }
    })
  })

  describe("validateOrderOnchain", () => {
    test("validates order components onchain successfully", async () => {
      const result = await fulfillmentManager.validateOrderOnchain(
        mockOrderComponents,
        "0xValidator",
      )

      expect(mockRequireAccountIsAvailable).toHaveBeenCalledTimes(1)
      expect(mockDispatch).toHaveBeenCalledTimes(1)
      expect(mockDispatch.mock.calls[0][0]).toBe(EventType.ApproveOrder)
      expect(mockSeaport.validate).toHaveBeenCalledTimes(1)
      expect(mockConfirmTransaction).toHaveBeenCalledTimes(1)
      expect(result).toBe("0xTxHash")
    })

    test("dispatches ApproveOrder event with order components", async () => {
      await fulfillmentManager.validateOrderOnchain(
        mockOrderComponents,
        "0xValidator",
      )

      const eventData = mockDispatch.mock.calls[0][1]
      expect(eventData.orderV2.protocolData).toBe(mockOrderComponents)
      expect(eventData.accountAddress).toBe("0xValidator")
    })

    test("calls validate with correct parameters", async () => {
      await fulfillmentManager.validateOrderOnchain(
        mockOrderComponents,
        "0xValidator",
      )

      const validateCall = mockSeaport.validate.mock.calls[0]
      expect(validateCall[0][0].parameters).toBe(mockOrderComponents)
      expect(validateCall[0][0].signature).toBe("0x")
      expect(validateCall[1]).toBe("0xValidator")
    })

    test("throws when account is not available", async () => {
      mockRequireAccountIsAvailable.mockRejectedValue(
        new Error("Account not available"),
      )

      try {
        await fulfillmentManager.validateOrderOnchain(
          mockOrderComponents,
          "0xValidator",
        )
        throw new Error("Expected error to be thrown")
      } catch (error) {
        expect((error as Error).message).toContain("Account not available")
      }
    })

    test("defaults to a supported protocol when the argument is omitted", async () => {
      // Locks in that the default protocolAddress clears requireValidProtocol.
      // Swapping it for an unsupported address fails here; swapping it for
      // another supported one is not observable, since getSeaportInstance
      // returns the SDK's single Seaport instance either way.
      const result = await fulfillmentManager.validateOrderOnchain(
        mockOrderComponents,
        "0xValidator",
      )

      expect(mockSeaport.validate).toHaveBeenCalledTimes(1)
      expect(result).toBe("0xTxHash")
    })

    test("accepts an explicit supported protocol address", async () => {
      const result = await fulfillmentManager.validateOrderOnchain(
        mockOrderComponents,
        "0xValidator",
        DEFAULT_SEAPORT_CONTRACT_ADDRESS,
      )

      expect(mockSeaport.validate).toHaveBeenCalledTimes(1)
      expect(result).toBe("0xTxHash")
    })

    test("throws for an unsupported protocol address", async () => {
      await expect(
        fulfillmentManager.validateOrderOnchain(
          mockOrderComponents,
          "0xValidator",
          "0x0000000000000000000000000000000000000bad",
        ),
      ).rejects.toThrow("Unsupported protocol")

      expect(mockSeaport.validate).not.toHaveBeenCalled()
    })
  })

  describe("createListingAndValidateOnchain", () => {
    test("creates and validates a listing successfully", async () => {
      const result = await fulfillmentManager.createListingAndValidateOnchain({
        asset: { tokenAddress: "0xNFT", tokenId: "123" },
        accountAddress: "0xSeller",
        amount: "1000000000000000000",
      })

      expect(
        mockOrdersManager.buildListingOrderComponents,
      ).toHaveBeenCalledTimes(1)
      expect(mockSeaport.validate).toHaveBeenCalledTimes(1)
      expect(result).toBe("0xTxHash")
    })

    test("forwards all listing parameters", async () => {
      await fulfillmentManager.createListingAndValidateOnchain({
        asset: { tokenAddress: "0xNFT", tokenId: "123" },
        accountAddress: "0xSeller",
        amount: "2000000000000000000",
        quantity: 5,
        domain: "opensea.io",
        salt: "12345",
        listingTime: 1000000,
        expirationTime: 2000000,
        buyerAddress: "0xBuyer",
        includeOptionalCreatorFees: true,
        zone: "0xZone",
      })

      const buildCall =
        mockOrdersManager.buildListingOrderComponents.mock.calls[0][0]
      expect(buildCall.asset.tokenAddress).toBe("0xNFT")
      expect(buildCall.amount).toBe("2000000000000000000")
      expect(buildCall.quantity).toBe(5)
      expect(buildCall.domain).toBe("opensea.io")
      expect(buildCall.buyerAddress).toBe("0xBuyer")
    })
  })

  describe("createOfferAndValidateOnchain", () => {
    test("creates and validates an offer successfully", async () => {
      const result = await fulfillmentManager.createOfferAndValidateOnchain({
        asset: { tokenAddress: "0xNFT", tokenId: "123" },
        accountAddress: "0xBuyer",
        amount: "1000000000000000000",
      })

      expect(mockOrdersManager.buildOfferOrderComponents).toHaveBeenCalledTimes(
        1,
      )
      expect(mockSeaport.validate).toHaveBeenCalledTimes(1)
      expect(result).toBe("0xTxHash")
    })

    test("forwards all offer parameters", async () => {
      await fulfillmentManager.createOfferAndValidateOnchain({
        asset: { tokenAddress: "0xNFT", tokenId: "123" },
        accountAddress: "0xBuyer",
        amount: "1500000000000000000",
        quantity: 3,
        domain: "test.io",
        salt: "67890",
        expirationTime: 3000000,
        zone: "0xSignedZone",
      })

      const buildCall =
        mockOrdersManager.buildOfferOrderComponents.mock.calls[0][0]
      expect(buildCall.asset.tokenAddress).toBe("0xNFT")
      expect(buildCall.amount).toBe("1500000000000000000")
      expect(buildCall.quantity).toBe(3)
      expect(buildCall.domain).toBe("test.io")
    })
  })

  describe("Constructor", () => {
    test("initializes with all required dependencies", () => {
      const mockContext = createMockContext({
        chain: Chain.Mainnet,
        api: mockAPI,
        seaport: mockSeaport,
        dispatch: mockDispatch,
        confirmTransaction: mockConfirmTransaction,
        requireAccountIsAvailable: mockRequireAccountIsAvailable,
      })

      const manager = new FulfillmentManager(mockContext, mockOrdersManager)

      expect(manager).toBeInstanceOf(FulfillmentManager)
    })
  })
})
