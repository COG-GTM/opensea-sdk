import { Seaport } from "@opensea/seaport-js"
import { CROSS_CHAIN_SEAPORT_V1_6_ADDRESS } from "@opensea/seaport-js/lib/constants"
import { ethers } from "ethers"
import { describe, expect, test, vi } from "vitest"
import { ALTERNATE_SEAPORT_V1_6_ADDRESS } from "../../src/constants"
import type { OrderV2 } from "../../src/orders/types"
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

const SEAPORT = CROSS_CHAIN_SEAPORT_V1_6_ADDRESS
const ZERO_ADDRESS = `0x${"0".repeat(40)}`
const ZERO_BYTES32 = `0x${"0".repeat(64)}`
const OPENSEA_CONDUIT_KEY =
  "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000"
const OPENSEA_FEE_RECIPIENT = "0x0000a26b00c1f0df003000390027140000faa719"
const SELLER_ADDRESS = "0xfba662e1a8e91a350702cf3b87d0c2d2fb4ba57f"

// Real seaport-js hashing, so the tests exercise the same order hash check
// the SDK runs against API responses. Constructing it makes no RPC calls.
const orderHasher = new Seaport(
  new ethers.JsonRpcProvider("http://127.0.0.1:8545", 1, {
    staticNetwork: true,
  }),
)

/** Order hash of API-shaped `OrderParameters` (tips excluded), counter 0. */
function orderHashOf(parameters: any, counter = "0"): string {
  const { totalOriginalConsiderationItems, ...rest } = parameters
  return orderHasher.getOrderHash({
    ...rest,
    consideration: rest.consideration.slice(
      0,
      Number(totalOriginalConsiderationItems),
    ),
    totalOriginalConsiderationItems: Number(totalOriginalConsiderationItems),
    counter,
  })
}

const ADVANCED_ORDER_PARAMETERS = {
  offerer: SELLER_ADDRESS,
  zone: ZERO_ADDRESS,
  offer: [
    {
      itemType: 3,
      token: "0x88d381e3c65221abea498c69e990d1deb7bd3863",
      identifierOrCriteria: "1",
      startAmount: "1",
      endAmount: "1",
    },
  ],
  consideration: [
    {
      itemType: 0,
      token: ZERO_ADDRESS,
      identifierOrCriteria: "0",
      startAmount: "99000000",
      endAmount: "99000000",
      recipient: SELLER_ADDRESS,
    },
  ],
  orderType: 1,
  startTime: "1759963495",
  endTime: "1775515495",
  zoneHash: ZERO_BYTES32,
  salt: "27855337018906766782546881864045825683096516384821792734247163280454785126732",
  conduitKey: OPENSEA_CONDUIT_KEY,
  totalOriginalConsiderationItems: "1",
}
const ORDER_HASH = orderHashOf(ADVANCED_ORDER_PARAMETERS)
const listingOrder: OrderV2 = { ...mockOrderV2, orderHash: ORDER_HASH }
const offerOrder: OrderV2 = { ...mockOfferOrderV2, orderHash: ORDER_HASH }

/** An ETH_TO_ERC721 basic order: 0.975 ETH to the seller plus a 0.025 ETH fee. */
const BASIC_ORDER_PARAMETERS = {
  considerationToken: ZERO_ADDRESS,
  considerationIdentifier: "0",
  considerationAmount: "975000000000000000",
  offerer: SELLER_ADDRESS,
  zone: ZERO_ADDRESS,
  offerToken: "0x88d381e3c65221abea498c69e990d1deb7bd3863",
  offerIdentifier: "42",
  offerAmount: "1",
  basicOrderType: 0,
  startTime: "1759963495",
  endTime: "1775515495",
  zoneHash: ZERO_BYTES32,
  salt: "123456789",
  offererConduitKey: OPENSEA_CONDUIT_KEY,
  fulfillerConduitKey: ZERO_BYTES32,
  totalOriginalAdditionalRecipients: "1",
  additionalRecipients: [
    { amount: "25000000000000000", recipient: OPENSEA_FEE_RECIPIENT },
  ],
  signature: "0x",
}
// The order the seller signed, written out independently of the SDK's
// basic-order conversion so the test checks that conversion.
const BASIC_ORDER_HASH = orderHasher.getOrderHash({
  offerer: SELLER_ADDRESS,
  zone: ZERO_ADDRESS,
  offer: [
    {
      itemType: 2,
      token: "0x88d381e3c65221abea498c69e990d1deb7bd3863",
      identifierOrCriteria: "42",
      startAmount: "1",
      endAmount: "1",
    },
  ],
  consideration: [
    {
      itemType: 0,
      token: ZERO_ADDRESS,
      identifierOrCriteria: "0",
      startAmount: "975000000000000000",
      endAmount: "975000000000000000",
      recipient: SELLER_ADDRESS,
    },
    {
      itemType: 0,
      token: ZERO_ADDRESS,
      identifierOrCriteria: "0",
      startAmount: "25000000000000000",
      endAmount: "25000000000000000",
      recipient: OPENSEA_FEE_RECIPIENT,
    },
  ],
  orderType: 0,
  startTime: "1759963495",
  endTime: "1775515495",
  zoneHash: ZERO_BYTES32,
  salt: "123456789",
  conduitKey: OPENSEA_CONDUIT_KEY,
  totalOriginalConsiderationItems: 2,
  counter: "0",
})
const basicListingOrder: OrderV2 = {
  ...mockOrderV2,
  orderHash: BASIC_ORDER_HASH,
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

    // Mock OpenSeaAPI with full transaction data
    mockAPI = {
      generateFulfillmentData: vi.fn().mockResolvedValue({
        fulfillmentData: {
          transaction: {
            to: SEAPORT,
            value: 0,
            function:
              "fulfillAdvancedOrder(((address,address,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[],uint8,uint256,uint256,bytes32,uint256,bytes32,uint256),uint120,uint120,bytes,bytes),(uint256,uint8,uint256,uint256,bytes32[])[],bytes32,address)",
            inputData: {
              advancedOrder: {
                parameters: ADVANCED_ORDER_PARAMETERS,
                numerator: 1,
                denominator: 1,
                signature: "0x",
                extraData: "0x",
              },
              criteriaResolvers: [],
              fulfillerConduitKey:
                "0x0000000000000000000000000000000000000000000000000000000000000000",
              recipient: "0x0000000000000000000000000000000000000000",
            },
          },
          orders: [{ signature: "0xNewSignature" }],
        },
      }),
    }

    // Mock Seaport
    mockSeaport = {
      getOrderHash: orderHasher.getOrderHash,
      getCounter: vi.fn().mockResolvedValue(0n),
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
        readContract: vi.fn(),
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
        order: listingOrder,
        accountAddress: "0xBuyer",
      })

      expect(mockRequireAccountIsAvailable).toHaveBeenCalledTimes(1)
      expect(mockAPI.generateFulfillmentData).toHaveBeenCalledTimes(1)
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      expect(mockConfirmTransaction).toHaveBeenCalledTimes(1)
      expect(result).toBe("0xFulfillTxHash")
    })

    test("fulfills an offer order successfully", async () => {
      const result = await fulfillmentManager.fulfillOrder({
        order: offerOrder,
        accountAddress: "0xSeller",
      })

      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      expect(result).toBe("0xFulfillTxHash")
    })

    test("fulfills criteria order with contract and tokenId", async () => {
      await fulfillmentManager.fulfillOrder({
        order: listingOrder,
        accountAddress: "0xBuyer",
        assetContractAddress: "0xNFT",
        tokenId: "123",
      })

      expect(mockAPI.generateFulfillmentData).toHaveBeenCalledTimes(1)
      const apiCall = mockAPI.generateFulfillmentData.mock.calls[0]
      expect(apiCall[4]).toBe("0xNFT")
      expect(apiCall[5]).toBe("123")
    })

    test("includes extraData when order has offer protection", async () => {
      mockAPI.generateFulfillmentData.mockResolvedValue({
        fulfillmentData: {
          transaction: {
            to: SEAPORT,
            value: 0,
            function:
              "fulfillAdvancedOrder(((address,address,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[],uint8,uint256,uint256,bytes32,uint256,bytes32,uint256),uint120,uint120,bytes,bytes),(uint256,uint8,uint256,uint256,bytes32[])[],bytes32,address)",
            inputData: {
              advancedOrder: {
                parameters: ADVANCED_ORDER_PARAMETERS,
                numerator: 1,
                denominator: 1,
                signature: "0x",
                extraData: "0x1234567890abcdef",
              },
              criteriaResolvers: [],
              fulfillerConduitKey:
                "0x0000000000000000000000000000000000000000000000000000000000000000",
              recipient: "0x0000000000000000000000000000000000000000",
            },
          },
          orders: [{ signature: "0xNewSignature" }],
        },
      })

      await fulfillmentManager.fulfillOrder({
        order: listingOrder,
        accountAddress: "0xBuyer",
      })

      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
    })

    test("fulfills order with recipient address", async () => {
      const recipientAddress = "0xRecipient123"
      await fulfillmentManager.fulfillOrder({
        order: listingOrder,
        accountAddress: "0xBuyer",
        recipientAddress,
      })

      expect(mockAPI.generateFulfillmentData).toHaveBeenCalledTimes(1)
      const apiCall = mockAPI.generateFulfillmentData.mock.calls[0]
      expect(apiCall[7]).toBe(recipientAddress)
    })

    test("appends the attribution suffix the API returns to the calldata", async () => {
      // Production returns calldata_suffix on every fulfillment response. The
      // SDK re-encodes the call from inputData, so it has to re-attach the
      // suffix or the fill goes onchain unattributed.
      mockAPI.generateFulfillmentData.mockResolvedValue({
        fulfillmentData: {
          transaction: {
            to: SEAPORT,
            value: 0,
            function: "fulfillBasicOrder_efficient_6GL6yc((uint256))",
            inputData: { parameters: BASIC_ORDER_PARAMETERS },
            calldataSuffix: "0xcdb44011",
          },
          orders: [{ signature: "0xSignature" }],
        },
      })
      const mockContractCaller = (fulfillmentManager as any).context
        .contractCaller
      mockContractCaller.encodeFunctionData.mockReturnValue("0xdeadbeef")

      await fulfillmentManager.fulfillOrder({
        order: basicListingOrder,
        accountAddress: "0xBuyer",
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
        order: listingOrder,
        accountAddress: "0xBuyer",
      })

      expect(mockSigner.sendTransaction.mock.calls[0][0].data).toBe(
        "0xdeadbeef",
      )
    })

    test("encodes fulfillBasicOrder alias using supported fragment", async () => {
      mockAPI.generateFulfillmentData.mockResolvedValue({
        fulfillmentData: {
          transaction: {
            to: SEAPORT,
            value: 0,
            function: "fulfillBasicOrder_efficient_6GL6yc((uint256))",
            inputData: {
              // The API names this `parameters`, not `basicOrderParameters`:
              // it serializes the decoded Seaport call, whose basic-order
              // variant carries a single `parameters` struct.
              parameters: BASIC_ORDER_PARAMETERS,
            },
          },
          orders: [{ signature: "0xAliasSignature" }],
        },
      })

      // Get the mock contractCaller from context
      const mockContractCaller = (fulfillmentManager as any).context
        .contractCaller
      mockContractCaller.encodeFunctionData.mockReturnValue("0xAliasEncoded")

      const result = await fulfillmentManager.fulfillOrder({
        order: basicListingOrder,
        accountAddress: "0xBuyer",
      })

      expect(result).toBe("0xFulfillTxHash")
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      expect(
        mockContractCaller.encodeFunctionData.mock.calls[0][0],
      ).toMatchObject({ functionName: "fulfillBasicOrder" })
      expect(mockSigner.sendTransaction.mock.calls[0][0].data).toBe(
        "0xAliasEncoded",
      )
    })

    test("encodes fulfillOrder with exactly 2 params (no recipient)", async () => {
      mockAPI.generateFulfillmentData.mockResolvedValue({
        fulfillmentData: {
          transaction: {
            to: SEAPORT,
            value: 0,
            function:
              "fulfillOrder(((address,address,(uint8,address,uint256,uint256,uint256)[],(uint8,address,uint256,uint256,uint256,address)[],uint8,uint256,uint256,bytes32,uint256,bytes32,uint256),bytes),bytes32)",
            inputData: {
              order: {
                parameters: ADVANCED_ORDER_PARAMETERS,
                signature: "0x",
              },
              fulfillerConduitKey:
                "0x0000000000000000000000000000000000000000000000000000000000000000",
              recipient: "0xSomeRecipient",
            },
          },
          orders: [{ signature: "0xOrderSignature" }],
        },
      })

      // Get the mock contractCaller from context
      const mockContractCaller = (fulfillmentManager as any).context
        .contractCaller
      mockContractCaller.encodeFunctionData.mockReturnValue(
        "0xFulfillOrderEncoded",
      )

      await fulfillmentManager.fulfillOrder({
        order: listingOrder,
        accountAddress: "0xBuyer",
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

      try {
        await fulfillmentManager.fulfillOrder({
          order: listingOrder,
          accountAddress: "0xBuyer",
        })
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
        await fulfillmentManager.fulfillOrder({
          order: invalidOrder,
          accountAddress: "0xBuyer",
        })
        throw new Error("Expected error to be thrown")
      } catch (error) {
        expect((error as Error).message).toContain("Unsupported protocol")
      }
    })

    test("handles transaction response as ContractTransactionResponse", async () => {
      const result = await fulfillmentManager.fulfillOrder({
        order: listingOrder,
        accountAddress: "0xBuyer",
      })

      expect(result).toBe("0xFulfillTxHash")
    })
  })

  describe("fulfillOrder with an ERC20-priced listing", () => {
    // Mainnet's default conduit, which the OpenSea API returns as the fulfiller
    // conduit key. The buyer approves this address, not Seaport.
    const CONDUIT_KEY =
      "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000"
    const CONDUIT_ADDRESS = "0x1e0049783f008a0085193e00003d00cd54003c71"
    const USDG = "0x1234567890123456789012345678901234567890"
    const SELLER = "0xfba662e1a8e91a350702cf3b87d0c2d2fb4ba57f"
    const ERC20_ORDER_PARAMETERS = {
      ...ADVANCED_ORDER_PARAMETERS,
      offerer: SELLER,
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
      totalOriginalConsiderationItems: 2,
    }
    const erc20Order = {
      ...mockOrderV2,
      orderHash: orderHashOf(ERC20_ORDER_PARAMETERS),
    }

    /** Price the mock listing in USDG: 351 to the seller plus a 9 USDG fee. */
    function priceInErc20({
      fulfillerConduitKey = CONDUIT_KEY,
    }: {
      fulfillerConduitKey?: string
    } = {}) {
      mockAPI.generateFulfillmentData.mockResolvedValue({
        fulfillmentData: {
          transaction: {
            to: SEAPORT,
            value: "0",
            function: "fulfillAdvancedOrder(...)",
            inputData: {
              advancedOrder: {
                parameters: {
                  ...ADVANCED_ORDER_PARAMETERS,
                  offerer: SELLER,
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
                  totalOriginalConsiderationItems: 2,
                },
                numerator: 1,
                denominator: 1,
                signature: "0x",
                extraData: "0x",
              },
              criteriaResolvers: [],
              fulfillerConduitKey,
              recipient: "0xBuyer",
            },
          },
        },
      })
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
      priceInErc20()
      stubErc20Reads({ balance: 500000000n, allowance: 360000000n })

      const result = await fulfillmentManager.fulfillOrder({
        order: erc20Order,
        accountAddress: "0xBuyer",
      })

      expect(result).toBe("0xFulfillTxHash")
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
    })

    test("throws before sending when the allowance is short of the total", async () => {
      priceInErc20()
      // Covers the seller's 351 but not the 9 USDG fee on top.
      stubErc20Reads({ balance: 500000000n, allowance: 351000000n })

      await expect(
        fulfillmentManager.fulfillOrder({
          order: erc20Order,
          accountAddress: "0xBuyer",
        }),
      ).rejects.toThrow(/not approved/)
      expect(mockSigner.sendTransaction).not.toHaveBeenCalled()
    })

    test("names the conduit and the amount to approve in the error", async () => {
      priceInErc20()
      stubErc20Reads({ balance: 500000000n, allowance: 0n })

      await expect(
        fulfillmentManager.fulfillOrder({
          order: erc20Order,
          accountAddress: "0xBuyer",
        }),
      ).rejects.toThrow(`approve(${CONDUIT_ADDRESS}, 360000000)`)
    })

    test("reports insufficient balance ahead of the allowance", async () => {
      priceInErc20()
      stubErc20Reads({ balance: 1n, allowance: 0n })

      await expect(
        fulfillmentManager.fulfillOrder({
          order: erc20Order,
          accountAddress: "0xBuyer",
        }),
      ).rejects.toThrow(/Insufficient/)
      expect(mockSigner.sendTransaction).not.toHaveBeenCalled()
    })

    test("checks the allowance against Seaport for a zero conduit key", async () => {
      priceInErc20({ fulfillerConduitKey: `0x${"0".repeat(64)}` })
      const readContract = stubErc20Reads({
        balance: 500000000n,
        allowance: 0n,
      })

      await expect(
        fulfillmentManager.fulfillOrder({
          order: erc20Order,
          accountAddress: "0xBuyer",
        }),
      ).rejects.toThrow(SEAPORT)

      // A zero key means Seaport transfers directly, so no conduit is resolved.
      expect(
        readContract.mock.calls.some(
          ([params]) => params.functionName === "getConduit",
        ),
      ).toBe(false)
    })

    test("resolves an unrecognized conduit key through the ConduitController", async () => {
      priceInErc20({ fulfillerConduitKey: `0x${"a".repeat(64)}` })
      const readContract = stubErc20Reads({
        balance: 500000000n,
        allowance: 0n,
      })

      await expect(
        fulfillmentManager.fulfillOrder({
          order: erc20Order,
          accountAddress: "0xBuyer",
        }),
      ).rejects.toThrow(CONDUIT_ADDRESS)

      expect(
        readContract.mock.calls.some(
          ([params]) => params.functionName === "getConduit",
        ),
      ).toBe(true)
    })

    test("submits anyway when the allowance cannot be read", async () => {
      priceInErc20()
      const readContract = (
        mockContext.contractCaller as unknown as {
          readContract: ReturnType<typeof vi.fn>
        }
      ).readContract
      readContract.mockRejectedValue(new Error("RPC unavailable"))

      const result = await fulfillmentManager.fulfillOrder({
        order: erc20Order,
        accountAddress: "0xBuyer",
      })

      // A failed preflight read must never block a purchase that would succeed.
      expect(result).toBe("0xFulfillTxHash")
    })

    test("reads nothing onchain for a native-priced listing", async () => {
      const readContract = (
        mockContext.contractCaller as unknown as {
          readContract: ReturnType<typeof vi.fn>
        }
      ).readContract

      await fulfillmentManager.fulfillOrder({
        order: listingOrder,
        accountAddress: "0xBuyer",
      })

      expect(readContract).not.toHaveBeenCalled()
    })
  })

  describe("fulfillOrder with remaining_quantity", () => {
    test("defaults to 1 when unitsToFill not specified for Listing", async () => {
      await fulfillmentManager.fulfillOrder({
        order: { ...mockListing, orderHash: ORDER_HASH },
        accountAddress: "0xBuyer",
      })

      // SDK defaults unitsToFill to "1" for both listings and offers
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      const apiCall = mockAPI.generateFulfillmentData.mock.calls[0]
      expect(apiCall[6]).toBe("1") // unitsToFill defaults to "1"
    })

    test("defaults to 1 when unitsToFill not specified for partially filled Listing", async () => {
      await fulfillmentManager.fulfillOrder({
        order: { ...mockListingPartiallyFilled, orderHash: ORDER_HASH },
        accountAddress: "0xBuyer",
      })

      // SDK defaults unitsToFill to "1" for both listings and offers
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      const apiCall = mockAPI.generateFulfillmentData.mock.calls[0]
      expect(apiCall[6]).toBe("1") // unitsToFill defaults to "1"
    })

    test("defaults to 1 when unitsToFill not specified for OrderV2", async () => {
      await fulfillmentManager.fulfillOrder({
        order: listingOrder,
        accountAddress: "0xBuyer",
      })

      // SDK defaults unitsToFill to "1" for both listings and offers
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      const apiCall = mockAPI.generateFulfillmentData.mock.calls[0]
      expect(apiCall[6]).toBe("1") // unitsToFill defaults to "1"
    })

    test("passes unitsToFill when specified", async () => {
      const order = {
        orderHash: ORDER_HASH,
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
        accountAddress: "0xBuyer",
        unitsToFill: 5,
      })

      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      const apiCall = mockAPI.generateFulfillmentData.mock.calls[0]
      expect(apiCall[6]).toBe("5") // unitsToFill passed to API
    })
  })

  describe("fulfillOrder rejects fulfillment data that does not match the order", () => {
    const MALLORY = "0x000000000000000000000000000000000000bad1"
    const ALICE = "0x000000000000000000000000000000000000a11c"
    const ADVANCED_FUNCTION = "fulfillAdvancedOrder(...)"

    function advancedTransaction(
      overrides: Record<string, unknown> = {},
      inputOverrides: Record<string, unknown> = {},
    ) {
      return {
        to: SEAPORT,
        value: "99000000",
        function: ADVANCED_FUNCTION,
        inputData: {
          advancedOrder: {
            parameters: ADVANCED_ORDER_PARAMETERS,
            numerator: 1,
            denominator: 1,
            signature: "0x",
            extraData: "0x",
          },
          criteriaResolvers: [],
          fulfillerConduitKey: ZERO_BYTES32,
          recipient: ZERO_ADDRESS,
          ...inputOverrides,
        },
        ...overrides,
      }
    }

    function basicTransaction(overrides: Record<string, unknown> = {}) {
      return {
        to: SEAPORT,
        value: "1000000000000000000",
        function: "fulfillBasicOrder_efficient_6GL6yc((address,uint256))",
        inputData: { parameters: BASIC_ORDER_PARAMETERS },
        ...overrides,
      }
    }

    function respondWith(transaction: Record<string, unknown>) {
      mockAPI.generateFulfillmentData.mockResolvedValue({
        fulfillmentData: { transaction, orders: [] },
      })
    }

    function encodeFunctionData() {
      return (
        mockContext.contractCaller as unknown as {
          encodeFunctionData: ReturnType<typeof vi.fn>
        }
      ).encodeFunctionData
    }

    async function expectRejected(
      message: RegExp,
      args: Partial<Parameters<FulfillmentManager["fulfillOrder"]>[0]> = {},
    ) {
      await expect(
        fulfillmentManager.fulfillOrder({
          order: listingOrder,
          accountAddress: "0xBuyer",
          ...args,
        }),
      ).rejects.toThrow(message)
      expect(encodeFunctionData()).not.toHaveBeenCalled()
      expect(mockSigner.sendTransaction).not.toHaveBeenCalled()
    }

    test("sends a matching transaction to the order's Seaport contract", async () => {
      respondWith(advancedTransaction())

      await fulfillmentManager.fulfillOrder({
        order: listingOrder,
        accountAddress: "0xBuyer",
      })

      const sent = mockSigner.sendTransaction.mock.calls[0][0]
      expect(sent.to).toBe(SEAPORT)
      expect(sent.value).toBe(99000000n)
    })

    test("rejects a transaction.to that is not a Seaport contract", async () => {
      respondWith(advancedTransaction({ to: MALLORY }))
      await expectRejected(/Unsupported protocol address/)
    })

    test("rejects a transaction.to that differs from the order's protocol address", async () => {
      respondWith(advancedTransaction({ to: ALTERNATE_SEAPORT_V1_6_ADDRESS }))
      await expectRejected(/does not match the order's protocol address/)
    })

    test.each([
      "incrementCounter()",
      "cancel((address,address,(uint8,address,uint256,uint256,uint256)[])[])",
      "matchAdvancedOrders(...)",
      "fulfillAvailableAdvancedOrders(...)",
      "validate(...)",
    ])("rejects the non-fulfill Seaport function %s", async fn => {
      respondWith(advancedTransaction({ function: fn }))
      await expectRejected(/unexpected Seaport function/)
    })

    test("rejects an order whose hash differs from the requested order", async () => {
      respondWith(
        advancedTransaction(
          {},
          {
            advancedOrder: {
              parameters: {
                ...ADVANCED_ORDER_PARAMETERS,
                consideration: [
                  {
                    ...ADVANCED_ORDER_PARAMETERS.consideration[0],
                    recipient: MALLORY,
                  },
                ],
              },
              numerator: 1,
              denominator: 1,
              signature: "0x",
              extraData: "0x",
            },
          },
        ),
      )
      await expectRejected(/does not match the requested order/)
    })

    test("rejects an order whose offerer is the fulfilling account", async () => {
      // An order offered by the caller skips Seaport's signature check, so the
      // API could otherwise spend the caller's approved assets.
      const victimOrder = { ...ADVANCED_ORDER_PARAMETERS, offerer: ALICE }
      respondWith(
        advancedTransaction(
          { value: "0" },
          {
            advancedOrder: {
              parameters: victimOrder,
              numerator: 1,
              denominator: 1,
              signature: "0x",
              extraData: "0x",
            },
          },
        ),
      )
      await expectRejected(/offerer is the fulfilling account/, {
        order: { ...listingOrder, orderHash: orderHashOf(victimOrder) },
        accountAddress: ALICE,
      })
    })

    test("rejects a value larger than the order's native price", async () => {
      respondWith(advancedTransaction({ value: "99000001" }))
      await expectRejected(/exceeds the order's native price 99000000/)
    })

    test("rejects a recipient other than the fulfiller", async () => {
      respondWith(advancedTransaction({}, { recipient: MALLORY }))
      await expectRejected(/recipient/)
    })

    test("accepts the recipientAddress the caller asked for", async () => {
      respondWith(advancedTransaction({}, { recipient: ALICE }))
      await fulfillmentManager.fulfillOrder({
        order: listingOrder,
        accountAddress: "0xBuyer",
        recipientAddress: ALICE,
      })
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
    })

    test("rejects tips appended to the signed order", async () => {
      const withTip = {
        ...ADVANCED_ORDER_PARAMETERS,
        consideration: [
          ...ADVANCED_ORDER_PARAMETERS.consideration,
          {
            itemType: 1,
            token: "0x1234567890123456789012345678901234567890",
            identifierOrCriteria: "0",
            startAmount: "1000000",
            endAmount: "1000000",
            recipient: MALLORY,
          },
        ],
      }
      respondWith(
        advancedTransaction(
          {},
          {
            advancedOrder: {
              parameters: withTip,
              numerator: 1,
              denominator: 1,
              signature: "0x",
              extraData: "0x",
            },
          },
        ),
      )
      await expectRejected(/appended to the signed order/)
    })

    test("rejects a criteria resolver for a token other than tokenId", async () => {
      respondWith(
        advancedTransaction(
          { value: "0" },
          {
            criteriaResolvers: [
              {
                orderIndex: 0,
                side: 1,
                index: 0,
                identifier: "2",
                criteriaProof: [],
              },
            ],
          },
        ),
      )
      await expectRejected(/does not point at a criteria item/, {
        order: offerOrder,
        accountAddress: "0xSeller",
        assetContractAddress: "0x88d381e3c65221abea498c69e990d1deb7bd3863",
        tokenId: "1",
      })
    })

    test("reads the offerer's counter onchain when the order has no protocolData", async () => {
      respondWith(advancedTransaction())
      const { protocolData: _protocolData, ...withoutProtocolData } = {
        ...mockListing,
        orderHash: ORDER_HASH,
      }

      await fulfillmentManager.fulfillOrder({
        order: withoutProtocolData,
        accountAddress: "0xBuyer",
      })

      expect(mockSeaport.getCounter).toHaveBeenCalledWith(SELLER_ADDRESS)
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
    })

    function advancedOrderWith(
      parameters: Record<string, unknown>,
      fraction: { numerator: number; denominator: number } = {
        numerator: 1,
        denominator: 1,
      },
    ) {
      return {
        advancedOrder: {
          parameters,
          ...fraction,
          signature: "0x",
          extraData: "0x",
        },
      }
    }

    describe("partial fills", () => {
      const TEN_UNITS = {
        ...ADVANCED_ORDER_PARAMETERS,
        offer: [
          {
            ...ADVANCED_ORDER_PARAMETERS.offer[0],
            startAmount: "10",
            endAmount: "10",
          },
        ],
        consideration: [
          {
            ...ADVANCED_ORDER_PARAMETERS.consideration[0],
            startAmount: "1000",
            endAmount: "1000",
          },
        ],
      }
      const tenUnitOrder = {
        ...listingOrder,
        orderHash: orderHashOf(TEN_UNITS),
      }

      test("sends a fill of the requested units at their share of the price", async () => {
        respondWith(
          advancedTransaction(
            { value: "200" },
            advancedOrderWith(TEN_UNITS, { numerator: 2, denominator: 10 }),
          ),
        )
        await fulfillmentManager.fulfillOrder({
          order: tenUnitOrder,
          accountAddress: "0xBuyer",
          unitsToFill: 2,
        })
        expect(mockSigner.sendTransaction.mock.calls[0][0].value).toBe(200n)
      })

      test("rejects a fill of more units than requested", async () => {
        respondWith(
          advancedTransaction(
            { value: "500" },
            advancedOrderWith(TEN_UNITS, { numerator: 5, denominator: 10 }),
          ),
        )
        await expectRejected(/more than the 2 requested/, {
          order: tenUnitOrder,
          unitsToFill: 2,
        })
      })

      test("rejects a value above the filled share of the price", async () => {
        respondWith(
          advancedTransaction(
            { value: "201" },
            advancedOrderWith(TEN_UNITS, { numerator: 2, denominator: 10 }),
          ),
        )
        await expectRejected(/exceeds the order's native price 200/, {
          order: tenUnitOrder,
          unitsToFill: 2,
        })
      })
    })

    describe("optional creator fees", () => {
      const CREATOR = "0x000000000000000000000000000000000000c0de"
      const withTip = (tip: Record<string, unknown>) =>
        advancedOrderWith({
          ...ADVANCED_ORDER_PARAMETERS,
          consideration: [
            ...ADVANCED_ORDER_PARAMETERS.consideration,
            { identifierOrCriteria: "0", recipient: CREATOR, ...tip },
          ],
        })
      const nativeTip = (amount: string) => ({
        itemType: 0,
        token: ZERO_ADDRESS,
        startAmount: amount,
        endAmount: amount,
      })

      test("sends a native tip within the cap", async () => {
        respondWith(
          advancedTransaction(
            { value: "108900000" },
            withTip(nativeTip("9900000")),
          ),
        )
        await fulfillmentManager.fulfillOrder({
          order: listingOrder,
          accountAddress: "0xBuyer",
          includeOptionalCreatorFees: true,
        })
        expect(mockSigner.sendTransaction.mock.calls[0][0].value).toBe(
          108900000n,
        )
      })

      test("rejects a native tip above the cap", async () => {
        respondWith(
          advancedTransaction(
            { value: "108900001" },
            withTip(nativeTip("9900001")),
          ),
        )
        await expectRejected(/exceed the cap of 9900000/, {
          includeOptionalCreatorFees: true,
        })
      })

      test("rejects an ERC20 tip on a native-priced order", async () => {
        respondWith(
          advancedTransaction(
            {},
            withTip({
              itemType: 1,
              token: "0x1234567890123456789012345678901234567890",
              startAmount: "1",
              endAmount: "1",
            }),
          ),
        )
        await expectRejected(/not in the order's payment currency/, {
          includeOptionalCreatorFees: true,
        })
      })
    })

    describe("criteria offers", () => {
      const COLLECTION = "0x88d381e3c65221abea498c69e990d1deb7bd3863"
      const OTHER_COLLECTION = "0x00000000000000000000000000000000000b0b00"
      const CRITERIA_OFFER = {
        ...ADVANCED_ORDER_PARAMETERS,
        offer: [
          {
            itemType: 1,
            token: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            identifierOrCriteria: "0",
            startAmount: "1000",
            endAmount: "1000",
          },
        ],
        consideration: [
          {
            itemType: 4,
            token: COLLECTION,
            identifierOrCriteria: "0",
            startAmount: "1",
            endAmount: "1",
            recipient: SELLER_ADDRESS,
          },
        ],
      }
      const criteriaOrder = {
        ...offerOrder,
        orderHash: orderHashOf(CRITERIA_OFFER),
      }
      const resolver = {
        orderIndex: 0,
        side: 1,
        index: 0,
        identifier: "7",
        criteriaProof: [],
      }

      function respondWithCriteriaFill() {
        respondWith(
          advancedTransaction(
            { value: "0" },
            {
              ...advancedOrderWith(CRITERIA_OFFER),
              criteriaResolvers: [resolver],
            },
          ),
        )
      }

      test("sends a fill of the requested token on the requested contract", async () => {
        respondWithCriteriaFill()
        await fulfillmentManager.fulfillOrder({
          order: criteriaOrder,
          accountAddress: "0xNftHolder",
          assetContractAddress: COLLECTION,
          tokenId: "7",
        })
        expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(1)
      })

      test("rejects a resolver on a contract other than assetContractAddress", async () => {
        respondWithCriteriaFill()
        await expectRejected(/not 0x00000000000000000000000000000000000b0b00/, {
          order: criteriaOrder,
          accountAddress: "0xNftHolder",
          assetContractAddress: OTHER_COLLECTION,
          tokenId: "7",
        })
      })

      test("rejects a resolver for a different token", async () => {
        respondWithCriteriaFill()
        await expectRejected(/identifier does not match token 8/, {
          order: criteriaOrder,
          accountAddress: "0xNftHolder",
          assetContractAddress: COLLECTION,
          tokenId: "8",
        })
      })
    })

    describe("basic orders", () => {
      test("sends a matching basic order at its full price", async () => {
        respondWith(basicTransaction())

        await fulfillmentManager.fulfillOrder({
          order: basicListingOrder,
          accountAddress: "0xBuyer",
        })

        const sent = mockSigner.sendTransaction.mock.calls[0][0]
        expect(sent.to).toBe(SEAPORT)
        expect(sent.value).toBe(1000000000000000000n)
      })

      test("rejects a basic order with a redirected fee recipient", async () => {
        respondWith(
          basicTransaction({
            inputData: {
              parameters: {
                ...BASIC_ORDER_PARAMETERS,
                additionalRecipients: [
                  { amount: "25000000000000000", recipient: MALLORY },
                ],
              },
            },
          }),
        )
        await expectRejected(/does not match the requested order/, {
          order: basicListingOrder,
        })
      })

      test("rejects a value larger than the basic order's price", async () => {
        respondWith(basicTransaction({ value: "1000000000000000001" }))
        await expectRejected(/exceeds/, { order: basicListingOrder })
      })
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
