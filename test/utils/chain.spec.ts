import { CROSS_CHAIN_SEAPORT_V1_6_ADDRESS } from "@opensea/seaport-js/lib/constants"
import { describe, expect, test } from "vitest"
import {
  ALTERNATE_CONDUIT_ADDRESS,
  ALTERNATE_CONDUIT_KEY,
  ALTERNATE_FEE_RECIPIENT,
  ALTERNATE_SEAPORT_V1_6_ADDRESS,
  ALTERNATE_SIGNED_ZONE_V2_ADDRESS,
  GUNZILLA_FEE_RECIPIENT,
  OPENSEA_CONDUIT_ADDRESS,
  OPENSEA_CONDUIT_ADDRESS_2,
  OPENSEA_CONDUIT_KEY,
  OPENSEA_CONDUIT_KEY_2,
  OPENSEA_FEE_RECIPIENT,
  OPENSEA_SIGNED_ZONE_V2,
  SOMNIA_FEE_RECIPIENT,
  WPOL_ADDRESS,
  ZERO_ADDRESS,
} from "../../src/constants"
import { Chain } from "../../src/types"
import {
  getChainId,
  getDefaultConduit,
  getDefaultPaymentTokenDecimals,
  getFeeRecipient,
  getListingPaymentToken,
  getNativeWrapTokenAddress,
  getOfferPaymentToken,
  getOfferPaymentTokenDecimals,
  getSeaportAddress,
  getSignedZone,
  usesAlternateProtocol,
  usesNativeStablecoinOffers,
} from "../../src/utils/chain"
import { CHAIN_ID_MAP } from "../../src/utils/chainIds.generated"

describe("Utils: chain", () => {
  describe("chain helper exhaustiveness", () => {
    // Payment-token helpers throw by design for chains without Seaport support.
    const SEAPORT_UNSUPPORTED_CHAINS = [Chain.Solana, Chain.Hyperliquid]
    const NO_WRAP_TOKEN_CHAINS = [Chain.StableChain, Chain.Arc]
    // Non-EVM chains with no numeric chain id
    const NO_CHAIN_ID_CHAINS = [Chain.Solana, Chain.Hyperliquid]
    const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
    const NUMERIC_CHAIN_ID_RE = /^\d+$/

    for (const chain of Object.values(Chain) as Chain[]) {
      test(`covers ${chain}`, () => {
        if (SEAPORT_UNSUPPORTED_CHAINS.includes(chain)) {
          expect(() => getOfferPaymentToken(chain)).toThrow()
          expect(() => getListingPaymentToken(chain)).toThrow()
        } else {
          expect(getOfferPaymentToken(chain)).toMatch(EVM_ADDRESS_RE)
          expect(getListingPaymentToken(chain)).toMatch(EVM_ADDRESS_RE)
          if (NO_WRAP_TOKEN_CHAINS.includes(chain)) {
            expect(usesNativeStablecoinOffers(chain)).toBe(true)
            expect(() => getNativeWrapTokenAddress(chain)).toThrow()
          } else {
            expect(usesNativeStablecoinOffers(chain)).toBe(false)
            expect(getOfferPaymentTokenDecimals(chain)).toBe(18)
            expect(getNativeWrapTokenAddress(chain)).toMatch(EVM_ADDRESS_RE)
          }
        }

        if (NO_CHAIN_ID_CHAINS.includes(chain)) {
          expect(() => getChainId(chain)).toThrow()
        } else {
          expect(getChainId(chain)).toMatch(NUMERIC_CHAIN_ID_RE)
        }
      })
    }
  })

  describe("getChainId", () => {
    const chainIdTests: Array<[Chain, string]> = [
      [Chain.Mainnet, "1"],
      [Chain.Polygon, "137"],
      [Chain.Avalanche, "43114"],
      [Chain.Arbitrum, "42161"],
      [Chain.Blast, "81457"],
      [Chain.Base, "8453"],
      [Chain.Optimism, "10"],
      [Chain.Zora, "7777777"],
      [Chain.Sei, "1329"],
      [Chain.B3, "8333"],
      [Chain.BeraChain, "80094"],
      [Chain.Flow, "747"],
      [Chain.ApeChain, "33139"],
      [Chain.Ronin, "2020"],
      [Chain.Abstract, "2741"],
      [Chain.Shape, "360"],
      [Chain.Unichain, "130"],
      [Chain.Gunzilla, "43419"],
      [Chain.HyperEVM, "999"],
      [Chain.Somnia, "5031"],
      [Chain.Monad, "143"],
      [Chain.MegaETH, "4326"],
      [Chain.Soneium, "1868"],
      [Chain.AnimeChain, "69000"],
      [Chain.Ink, "57073"],
      [Chain.Robinhood, "4663"],
      [Chain.Mode, "34443"],
      [Chain.Arc, "5042"],
      [Chain.Scroll, "534352"],
      [Chain.Taiko, "167000"],
      [Chain.Gnosis, "100"],
      [Chain.Moonbeam, "1284"],
      [Chain.Lisk, "1135"],
      [Chain.WorldChain, "480"],
      [Chain.Kaia, "8217"],
    ]

    for (const [chain, expectedId] of chainIdTests) {
      test(`returns correct chain ID for ${chain}`, () => {
        expect(getChainId(chain)).toBe(expectedId)
      })
    }

    test("CHAIN_ID_MAP stays sorted by numeric chain id", () => {
      const ids = Object.values(CHAIN_ID_MAP).map(Number)
      expect(ids).toEqual([...ids].sort((a, b) => a - b))
    })

    test("throws for unknown chain", () => {
      expect(() => getChainId("UNKNOWN_CHAIN" as Chain)).toThrow(
        "Unknown chainId for UNKNOWN_CHAIN",
      )
    })

    test("throws for Solana and Hyperliquid", () => {
      expect(() => getChainId(Chain.Solana)).toThrow(
        "Chain solana has no EVM chain ID for OpenSea Seaport operations",
      )
      expect(() => getChainId(Chain.Hyperliquid)).toThrow(
        "Chain hyperliquid has no EVM chain ID for OpenSea Seaport operations",
      )
    })
  })

  describe("getOfferPaymentToken", () => {
    test("returns WETH for Mainnet", () => {
      expect(getOfferPaymentToken(Chain.Mainnet)).toBe(
        "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      )
    })

    test("returns WETH for Polygon", () => {
      expect(getOfferPaymentToken(Chain.Polygon)).toBe(
        "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      )
    })

    test("returns WAVAX for Avalanche", () => {
      expect(getOfferPaymentToken(Chain.Avalanche)).toBe(
        "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
      )
    })

    test("returns WETH for Arbitrum", () => {
      expect(getOfferPaymentToken(Chain.Arbitrum)).toBe(
        "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
      )
    })

    test("returns WETH for Blast", () => {
      expect(getOfferPaymentToken(Chain.Blast)).toBe(
        "0x4300000000000000000000000000000000000004",
      )
    })

    test("returns WETH for OP chains (same address)", () => {
      const opChains = [
        Chain.Base,
        Chain.Optimism,
        Chain.Zora,
        Chain.B3,
        Chain.Shape,
        Chain.Unichain,
        Chain.Ink,
        Chain.Soneium,
        Chain.Lisk,
        Chain.WorldChain,
      ]
      const expectedAddress = "0x4200000000000000000000000000000000000006"

      for (const chain of opChains) {
        expect(getOfferPaymentToken(chain)).toBe(expectedAddress)
      }
    })

    test("returns WETH for Taiko", () => {
      expect(getOfferPaymentToken(Chain.Taiko)).toBe(
        "0xA51894664A773981C6C112C43ce576f315d5b1B6",
      )
    })

    test("returns WBERA for BeraChain", () => {
      expect(getOfferPaymentToken(Chain.BeraChain)).toBe(
        "0x6969696969696969696969696969696969696969",
      )
    })

    test("returns WSEI for Sei", () => {
      expect(getOfferPaymentToken(Chain.Sei)).toBe(
        "0xe30fedd158a2e3b13e9badaeabafc5516e95e8c7",
      )
    })

    test("returns WFLOW for Flow", () => {
      expect(getOfferPaymentToken(Chain.Flow)).toBe(
        "0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e",
      )
    })

    test("returns WAPE for ApeChain", () => {
      expect(getOfferPaymentToken(Chain.ApeChain)).toBe(
        "0x48b62137edfa95a428d35c09e44256a739f6b557",
      )
    })

    test("returns WRON for Ronin", () => {
      expect(getOfferPaymentToken(Chain.Ronin)).toBe(
        "0xe514d9deb7966c8be0ca922de8a064264ea6bcd4",
      )
    })

    test("returns WETH for Abstract", () => {
      expect(getOfferPaymentToken(Chain.Abstract)).toBe(
        "0x3439153eb7af838ad19d56e1571fbd09333c2809",
      )
    })

    test("returns WGUN for Gunzilla", () => {
      expect(getOfferPaymentToken(Chain.Gunzilla)).toBe(
        "0x5aad7bba61d95c2c4e525a35f4062040264611f1",
      )
    })

    test("returns WHYPE for HyperEVM", () => {
      expect(getOfferPaymentToken(Chain.HyperEVM)).toBe(
        "0x5555555555555555555555555555555555555555",
      )
    })

    test("returns WSOMI for Somnia", () => {
      expect(getOfferPaymentToken(Chain.Somnia)).toBe(
        "0x046ede9564a72571df6f5e44d0405360c0f4dcab",
      )
    })

    test("returns WETH for MegaETH", () => {
      expect(getOfferPaymentToken(Chain.MegaETH)).toBe(
        "0x4200000000000000000000000000000000000006",
      )
    })

    test("returns WANIME for AnimeChain", () => {
      expect(getOfferPaymentToken(Chain.AnimeChain)).toBe(
        "0x164906a76f1a2ea933366c446ae0ec6a37062c42",
      )
    })

    test("returns WETH for Robinhood", () => {
      expect(getOfferPaymentToken(Chain.Robinhood)).toBe(
        "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
      )
    })

    test("returns WXDAI for Gnosis", () => {
      expect(getOfferPaymentToken(Chain.Gnosis)).toBe(
        "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d",
      )
    })

    test("returns USDT0 for Stable Chain", () => {
      expect(getOfferPaymentToken(Chain.StableChain)).toBe(
        "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      )
    })

    test("returns USDC for Arc", () => {
      expect(getOfferPaymentToken(Chain.Arc)).toBe(
        "0x3600000000000000000000000000000000000000",
      )
    })

    test("returns WGLMR for Moonbeam", () => {
      expect(getOfferPaymentToken(Chain.Moonbeam)).toBe(
        "0xAcc15dC74880C9944775448304B263D191c6077F",
      )
    })

    test("throws for Solana", () => {
      expect(() => getOfferPaymentToken(Chain.Solana)).toThrow(
        "Chain solana is not supported for OpenSea Seaport offers",
      )
    })

    test("throws for Hyperliquid", () => {
      expect(() => getOfferPaymentToken(Chain.Hyperliquid)).toThrow(
        "Chain hyperliquid is not supported for OpenSea Seaport offers",
      )
    })

    test("throws for unknown chain", () => {
      expect(() => getOfferPaymentToken("UNKNOWN_CHAIN" as Chain)).toThrow(
        "Unknown offer currency for UNKNOWN_CHAIN",
      )
    })
  })

  describe("getOfferPaymentTokenDecimals", () => {
    test("returns 6 for the Arc and Stable Chain stablecoin mirrors", () => {
      expect(getOfferPaymentTokenDecimals(Chain.Arc)).toBe(6)
      expect(getOfferPaymentTokenDecimals(Chain.StableChain)).toBe(6)
    })

    test("returns 18 for wrapped-native offer currencies", () => {
      expect(getOfferPaymentTokenDecimals(Chain.Mainnet)).toBe(18)
      expect(getOfferPaymentTokenDecimals(Chain.Polygon)).toBe(18)
      expect(getOfferPaymentTokenDecimals(Chain.Base)).toBe(18)
      expect(getOfferPaymentTokenDecimals(Chain.Moonbeam)).toBe(18)
    })
  })

  describe("getDefaultPaymentTokenDecimals", () => {
    test("seeds the offer mirror with 6 decimals and native listings with 18 on Arc", () => {
      expect(getDefaultPaymentTokenDecimals(Chain.Arc)).toEqual({
        "0x3600000000000000000000000000000000000000": 6,
        [ZERO_ADDRESS]: 18,
      })
    })

    test("seeds the offer mirror with 6 decimals and native listings with 18 on Stable Chain", () => {
      expect(getDefaultPaymentTokenDecimals(Chain.StableChain)).toEqual({
        "0x779ded0c9e1022225f8e0630b35a9b54be713736": 6,
        [ZERO_ADDRESS]: 18,
      })
    })

    test("seeds WETH and ETH with 18 decimals on Mainnet", () => {
      expect(getDefaultPaymentTokenDecimals(Chain.Mainnet)).toEqual({
        "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 18,
        [ZERO_ADDRESS]: 18,
      })
    })

    test("seeds WGLMR and GLMR with 18 decimals on Moonbeam", () => {
      expect(getDefaultPaymentTokenDecimals(Chain.Moonbeam)).toEqual({
        "0xacc15dc74880c9944775448304b263d191c6077f": 18,
        [ZERO_ADDRESS]: 18,
      })
    })

    test("keys by lowercase address when the offer and listing token coincide", () => {
      expect(getDefaultPaymentTokenDecimals(Chain.Polygon)).toEqual({
        "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": 18,
      })
    })
  })

  describe("getListingPaymentToken", () => {
    test("returns ETH (0x0) for Mainnet", () => {
      expect(getListingPaymentToken(Chain.Mainnet)).toBe(ZERO_ADDRESS)
    })

    test("returns ETH (0x0) for chains with native ETH", () => {
      const ethChains = [
        Chain.Mainnet,
        Chain.Somnia,
        Chain.Soneium,
        Chain.HyperEVM,
        Chain.Arbitrum,
        Chain.Blast,
        Chain.Base,
        Chain.Optimism,
        Chain.Zora,
        Chain.B3,
        Chain.Abstract,
        Chain.Shape,
        Chain.Unichain,
        Chain.MegaETH,
        Chain.Ink,
        Chain.Taiko,
        Chain.Lisk,
        Chain.WorldChain,
      ]

      for (const chain of ethChains) {
        expect(getListingPaymentToken(chain)).toBe(
          "0x0000000000000000000000000000000000000000",
        )
      }
    })

    test("returns xDAI (0x0) for Gnosis", () => {
      expect(getListingPaymentToken(Chain.Gnosis)).toBe(ZERO_ADDRESS)
    })

    test("returns ANIME (0x0) for AnimeChain", () => {
      expect(getListingPaymentToken(Chain.AnimeChain)).toBe(
        "0x0000000000000000000000000000000000000000",
      )
    })

    test("returns WETH for Polygon", () => {
      expect(getListingPaymentToken(Chain.Polygon)).toBe(
        "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      )
    })

    test("returns native gUSDT0 for Stable Chain", () => {
      expect(getListingPaymentToken(Chain.StableChain)).toBe(ZERO_ADDRESS)
    })

    test("returns native USDC for Arc", () => {
      expect(getListingPaymentToken(Chain.Arc)).toBe(ZERO_ADDRESS)
    })

    test("returns native GLMR for Moonbeam", () => {
      expect(getListingPaymentToken(Chain.Moonbeam)).toBe(ZERO_ADDRESS)
    })

    test("returns WAVAX for Avalanche", () => {
      expect(getListingPaymentToken(Chain.Avalanche)).toBe(
        "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
      )
    })

    test("returns BERA (0x0) for BeraChain", () => {
      expect(getListingPaymentToken(Chain.BeraChain)).toBe(
        "0x0000000000000000000000000000000000000000",
      )
    })

    test("returns SEI (0x0) for Sei", () => {
      expect(getListingPaymentToken(Chain.Sei)).toBe(
        "0x0000000000000000000000000000000000000000",
      )
    })

    test("returns WFLOW for Flow", () => {
      expect(getListingPaymentToken(Chain.Flow)).toBe(
        "0xd3bf53dac106a0290b0483ecbc89d40fcc961f3e",
      )
    })

    test("returns APE (0x0) for ApeChain", () => {
      expect(getListingPaymentToken(Chain.ApeChain)).toBe(
        "0x0000000000000000000000000000000000000000",
      )
    })

    test("returns WETH for Ronin", () => {
      expect(getListingPaymentToken(Chain.Ronin)).toBe(
        "0xe514d9deb7966c8be0ca922de8a064264ea6bcd4",
      )
    })

    test("returns GUN (0x0) for Gunzilla", () => {
      expect(getListingPaymentToken(Chain.Gunzilla)).toBe(
        "0x0000000000000000000000000000000000000000",
      )
    })

    test("throws for Solana", () => {
      expect(() => getListingPaymentToken(Chain.Solana)).toThrow(
        "Chain solana is not supported for OpenSea Seaport listings",
      )
    })

    test("throws for Hyperliquid", () => {
      expect(() => getListingPaymentToken(Chain.Hyperliquid)).toThrow(
        "Chain hyperliquid is not supported for OpenSea Seaport listings",
      )
    })

    test("throws for unknown chain", () => {
      expect(() => getListingPaymentToken("UNKNOWN_CHAIN" as Chain)).toThrow(
        "Unknown listing currency for UNKNOWN_CHAIN",
      )
    })
  })

  describe("getDefaultConduit", () => {
    test("returns default OpenSea conduit for Mainnet", () => {
      const result = getDefaultConduit(Chain.Mainnet)
      expect(result.key).toBe(OPENSEA_CONDUIT_KEY)
      expect(result.address).toBe(OPENSEA_CONDUIT_ADDRESS)
    })

    test("returns conduit 2 for Abstract", () => {
      const result = getDefaultConduit(Chain.Abstract)
      expect(result.key).toBe(OPENSEA_CONDUIT_KEY_2)
      expect(result.address).toBe(OPENSEA_CONDUIT_ADDRESS_2)
    })

    test("returns conduit 2 for HyperEVM", () => {
      const result = getDefaultConduit(Chain.HyperEVM)
      expect(result.key).toBe(OPENSEA_CONDUIT_KEY_2)
      expect(result.address).toBe(OPENSEA_CONDUIT_ADDRESS_2)
    })

    test("returns conduit 2 for Robinhood", () => {
      const result = getDefaultConduit(Chain.Robinhood)
      expect(result.key).toBe(OPENSEA_CONDUIT_KEY_2)
      expect(result.address).toBe(OPENSEA_CONDUIT_ADDRESS_2)
    })

    test("returns conduit 2 for Stable Chain", () => {
      const result = getDefaultConduit(Chain.StableChain)
      expect(result.key).toBe(OPENSEA_CONDUIT_KEY_2)
      expect(result.address).toBe(OPENSEA_CONDUIT_ADDRESS_2)
    })

    test("returns conduit 2 for Arc", () => {
      const result = getDefaultConduit(Chain.Arc)
      expect(result.key).toBe(OPENSEA_CONDUIT_KEY_2)
      expect(result.address).toBe(OPENSEA_CONDUIT_ADDRESS_2)
    })

    test("returns default OpenSea conduit for Moonbeam", () => {
      const result = getDefaultConduit(Chain.Moonbeam)
      expect(result.key).toBe(OPENSEA_CONDUIT_KEY)
      expect(result.address).toBe(OPENSEA_CONDUIT_ADDRESS)
    })

    test("returns alternate conduit for Gunzilla", () => {
      const result = getDefaultConduit(Chain.Gunzilla)
      expect(result.key).toBe(ALTERNATE_CONDUIT_KEY)
      expect(result.address).toBe(ALTERNATE_CONDUIT_ADDRESS)
    })

    test("returns alternate conduit for Somnia", () => {
      const result = getDefaultConduit(Chain.Somnia)
      expect(result.key).toBe(ALTERNATE_CONDUIT_KEY)
      expect(result.address).toBe(ALTERNATE_CONDUIT_ADDRESS)
    })

    test("returns alternate conduit for MegaETH", () => {
      const result = getDefaultConduit(Chain.MegaETH)
      expect(result.key).toBe(ALTERNATE_CONDUIT_KEY)
      expect(result.address).toBe(ALTERNATE_CONDUIT_ADDRESS)
    })

    test("returns the OpenSea conduit for Gnosis", () => {
      const conduit = getDefaultConduit(Chain.Gnosis)
      expect(conduit.key).toBe(OPENSEA_CONDUIT_KEY)
      expect(conduit.address).toBe(OPENSEA_CONDUIT_ADDRESS)
      expect(conduit.address).toBe("0x1e0049783f008a0085193e00003d00cd54003c71")
    })

    test("returns default OpenSea conduit for other chains", () => {
      const otherChains = [
        Chain.Polygon,
        Chain.Arbitrum,
        Chain.Base,
        Chain.Optimism,
      ]

      for (const chain of otherChains) {
        const result = getDefaultConduit(chain)
        expect(result.key).toBe(OPENSEA_CONDUIT_KEY)
        expect(result.address).toBe(OPENSEA_CONDUIT_ADDRESS)
      }
    })
  })

  describe("Taiko wiring", () => {
    test("lists in native ETH", () => {
      expect(getListingPaymentToken(Chain.Taiko)).toBe(ZERO_ADDRESS)
    })

    test("offers and wraps with Taiko WETH", () => {
      const weth = "0xA51894664A773981C6C112C43ce576f315d5b1B6"
      expect(getOfferPaymentToken(Chain.Taiko)).toBe(weth)
      expect(getNativeWrapTokenAddress(Chain.Taiko)).toBe(weth)
      expect(getOfferPaymentTokenDecimals(Chain.Taiko)).toBe(18)
      expect(getDefaultPaymentTokenDecimals(Chain.Taiko)).toEqual({
        [weth.toLowerCase()]: 18,
        [ZERO_ADDRESS]: 18,
      })
    })

    test("uses the standard OpenSea conduit, Seaport, zone and fee recipient", () => {
      expect(getDefaultConduit(Chain.Taiko)).toEqual({
        key: OPENSEA_CONDUIT_KEY,
        address: OPENSEA_CONDUIT_ADDRESS,
      })
      expect(getSeaportAddress(Chain.Taiko)).toBe(
        CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
      )
      expect(getSignedZone(Chain.Taiko)).toBe(OPENSEA_SIGNED_ZONE_V2)
      expect(getFeeRecipient(Chain.Taiko)).toBe(OPENSEA_FEE_RECIPIENT)
      expect(usesAlternateProtocol(Chain.Taiko)).toBe(false)
    })
  })

  describe("getSeaportAddress", () => {
    test("returns cross-chain Seaport 1.6 for Mainnet", () => {
      expect(getSeaportAddress(Chain.Mainnet)).toBe(
        CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
      )
    })

    test("returns cross-chain Seaport 1.6 for Moonbeam", () => {
      expect(getSeaportAddress(Chain.Moonbeam)).toBe(
        CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
      )
    })

    test("returns alternate Seaport 1.6 for Gunzilla", () => {
      expect(getSeaportAddress(Chain.Gunzilla)).toBe(
        ALTERNATE_SEAPORT_V1_6_ADDRESS,
      )
    })

    test("returns alternate Seaport 1.6 for Somnia", () => {
      expect(getSeaportAddress(Chain.Somnia)).toBe(
        ALTERNATE_SEAPORT_V1_6_ADDRESS,
      )
    })

    test("returns alternate Seaport 1.6 for MegaETH", () => {
      expect(getSeaportAddress(Chain.MegaETH)).toBe(
        ALTERNATE_SEAPORT_V1_6_ADDRESS,
      )
    })

    test("returns cross-chain Seaport 1.6 for other chains", () => {
      const otherChains = [
        Chain.Polygon,
        Chain.Arbitrum,
        Chain.Base,
        Chain.Optimism,
        Chain.Zora,
      ]

      for (const chain of otherChains) {
        expect(getSeaportAddress(chain)).toBe(CROSS_CHAIN_SEAPORT_V1_6_ADDRESS)
      }
    })
  })

  describe("Gnosis protocol addresses", () => {
    test("uses cross-chain Seaport 1.6, signed zone v2 and fee recipient", () => {
      expect(usesAlternateProtocol(Chain.Gnosis)).toBe(false)
      expect(getSeaportAddress(Chain.Gnosis)).toBe(
        CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
      )
      expect(getSignedZone(Chain.Gnosis)).toBe(OPENSEA_SIGNED_ZONE_V2)
      expect(getFeeRecipient(Chain.Gnosis)).toBe(OPENSEA_FEE_RECIPIENT)
    })
  })

  describe("getSignedZone", () => {
    test("returns OpenSea signed zone for Mainnet", () => {
      expect(getSignedZone(Chain.Mainnet)).toBe(OPENSEA_SIGNED_ZONE_V2)
    })

    test("returns OpenSea signed zone for Moonbeam", () => {
      expect(getSignedZone(Chain.Moonbeam)).toBe(OPENSEA_SIGNED_ZONE_V2)
    })

    test("returns alternate signed zone for Gunzilla", () => {
      expect(getSignedZone(Chain.Gunzilla)).toBe(
        ALTERNATE_SIGNED_ZONE_V2_ADDRESS,
      )
    })

    test("returns alternate signed zone for Somnia", () => {
      expect(getSignedZone(Chain.Somnia)).toBe(ALTERNATE_SIGNED_ZONE_V2_ADDRESS)
    })

    test("returns alternate signed zone for MegaETH", () => {
      expect(getSignedZone(Chain.MegaETH)).toBe(
        ALTERNATE_SIGNED_ZONE_V2_ADDRESS,
      )
    })

    test("returns OpenSea signed zone for other chains", () => {
      const otherChains = [
        Chain.Polygon,
        Chain.Arbitrum,
        Chain.Base,
        Chain.Optimism,
      ]

      for (const chain of otherChains) {
        expect(getSignedZone(chain)).toBe(OPENSEA_SIGNED_ZONE_V2)
      }
    })
  })

  describe("getFeeRecipient", () => {
    test("returns OpenSea fee recipient for Mainnet", () => {
      expect(getFeeRecipient(Chain.Mainnet)).toBe(OPENSEA_FEE_RECIPIENT)
    })

    test("returns OpenSea fee recipient for Moonbeam", () => {
      expect(getFeeRecipient(Chain.Moonbeam)).toBe(OPENSEA_FEE_RECIPIENT)
    })

    test("returns Gunzilla fee recipient for Gunzilla", () => {
      expect(getFeeRecipient(Chain.Gunzilla)).toBe(GUNZILLA_FEE_RECIPIENT)
    })

    test("returns Somnia fee recipient for Somnia", () => {
      expect(getFeeRecipient(Chain.Somnia)).toBe(SOMNIA_FEE_RECIPIENT)
    })

    test("returns alternate fee recipient for MegaETH", () => {
      expect(getFeeRecipient(Chain.MegaETH)).toBe(ALTERNATE_FEE_RECIPIENT)
    })

    test("returns OpenSea fee recipient for other chains", () => {
      const otherChains = [
        Chain.Polygon,
        Chain.Arbitrum,
        Chain.Base,
        Chain.Optimism,
        Chain.Zora,
      ]

      for (const chain of otherChains) {
        expect(getFeeRecipient(chain)).toBe(OPENSEA_FEE_RECIPIENT)
      }
    })
  })

  describe("usesAlternateProtocol", () => {
    test("returns true for Gunzilla", () => {
      expect(usesAlternateProtocol(Chain.Gunzilla)).toBe(true)
    })

    test("returns true for Somnia", () => {
      expect(usesAlternateProtocol(Chain.Somnia)).toBe(true)
    })

    test("returns true for MegaETH", () => {
      expect(usesAlternateProtocol(Chain.MegaETH)).toBe(true)
    })

    test("returns false for Mainnet", () => {
      expect(usesAlternateProtocol(Chain.Mainnet)).toBe(false)
    })

    test("returns false for Moonbeam", () => {
      expect(usesAlternateProtocol(Chain.Moonbeam)).toBe(false)
    })

    test("returns false for other standard chains", () => {
      const standardChains = [
        Chain.Polygon,
        Chain.Arbitrum,
        Chain.Base,
        Chain.Optimism,
        Chain.Zora,
        Chain.Avalanche,
        Chain.Blast,
        Chain.Sei,
        Chain.BeraChain,
        Chain.Abstract,
        Chain.HyperEVM,
        Chain.Monad,
      ]

      for (const chain of standardChains) {
        expect(usesAlternateProtocol(chain)).toBe(false)
      }
    })
  })

  describe("getNativeWrapTokenAddress", () => {
    test("returns WPOL for Polygon", () => {
      expect(getNativeWrapTokenAddress(Chain.Polygon)).toBe(WPOL_ADDRESS)
    })

    test("returns WETH for Mainnet (same as offer token)", () => {
      expect(getNativeWrapTokenAddress(Chain.Mainnet)).toBe(
        getOfferPaymentToken(Chain.Mainnet),
      )
    })

    test("returns offer payment token for non-Polygon chains", () => {
      const nonPolygonChains = [
        Chain.Mainnet,
        Chain.Arbitrum,
        Chain.Base,
        Chain.Optimism,
        Chain.Avalanche,
        Chain.Blast,
        Chain.Gunzilla,
        Chain.Somnia,
        Chain.MegaETH,
      ]

      for (const chain of nonPolygonChains) {
        expect(getNativeWrapTokenAddress(chain)).toBe(
          getOfferPaymentToken(chain),
        )
      }
    })

    test("returns WXDAI for Gnosis (same as offer token)", () => {
      expect(getNativeWrapTokenAddress(Chain.Gnosis)).toBe(
        "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d",
      )
    })

    test("returns WGLMR for Moonbeam (same as offer token)", () => {
      expect(getNativeWrapTokenAddress(Chain.Moonbeam)).toBe(
        "0xAcc15dC74880C9944775448304B263D191c6077F",
      )
    })

    test("throws for Stable Chain", () => {
      expect(() => getNativeWrapTokenAddress(Chain.StableChain)).toThrow(
        "0x779ded0c9e1022225f8e0630b35a9b54be713736",
      )
    })

    test("throws for Arc", () => {
      expect(() => getNativeWrapTokenAddress(Chain.Arc)).toThrow(
        "0x3600000000000000000000000000000000000000",
      )
    })
  })

  describe("Scroll", () => {
    const SCROLL_WETH = "0x5300000000000000000000000000000000000004"

    test("lists in native ETH", () => {
      expect(getListingPaymentToken(Chain.Scroll)).toBe(ZERO_ADDRESS)
    })

    test("offers in WETH", () => {
      expect(getOfferPaymentToken(Chain.Scroll)).toBe(SCROLL_WETH)
      expect(getOfferPaymentTokenDecimals(Chain.Scroll)).toBe(18)
    })

    test("wraps native ETH through WETH", () => {
      expect(getNativeWrapTokenAddress(Chain.Scroll)).toBe(SCROLL_WETH)
    })

    test("uses the standard OpenSea protocol addresses", () => {
      expect(usesAlternateProtocol(Chain.Scroll)).toBe(false)
      expect(getDefaultConduit(Chain.Scroll)).toEqual({
        key: OPENSEA_CONDUIT_KEY,
        address: OPENSEA_CONDUIT_ADDRESS,
      })
      expect(getSeaportAddress(Chain.Scroll)).toBe(
        CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
      )
      expect(getSignedZone(Chain.Scroll)).toBe(OPENSEA_SIGNED_ZONE_V2)
      expect(getFeeRecipient(Chain.Scroll)).toBe(OPENSEA_FEE_RECIPIENT)
    })
  })

  describe("Mode", () => {
    test("returns chain id 34443", () => {
      expect(getChainId(Chain.Mode)).toBe("34443")
    })

    test("lists in native ETH", () => {
      expect(getListingPaymentToken(Chain.Mode)).toBe(ZERO_ADDRESS)
    })

    test("offers in the OP-stack WETH predeploy", () => {
      expect(getOfferPaymentToken(Chain.Mode)).toBe(
        "0x4200000000000000000000000000000000000006",
      )
      expect(getOfferPaymentTokenDecimals(Chain.Mode)).toBe(18)
    })

    test("wraps native ETH into the offer token", () => {
      expect(getNativeWrapTokenAddress(Chain.Mode)).toBe(
        "0x4200000000000000000000000000000000000006",
      )
    })

    test("uses the standard OpenSea conduit", () => {
      expect(getDefaultConduit(Chain.Mode)).toEqual({
        key: OPENSEA_CONDUIT_KEY,
        address: OPENSEA_CONDUIT_ADDRESS,
      })
    })

    test("uses the standard Seaport, signed zone and fee recipient", () => {
      expect(usesAlternateProtocol(Chain.Mode)).toBe(false)
      expect(getSeaportAddress(Chain.Mode)).toBe(
        CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
      )
      expect(getSignedZone(Chain.Mode)).toBe(OPENSEA_SIGNED_ZONE_V2)
      expect(getFeeRecipient(Chain.Mode)).toBe(OPENSEA_FEE_RECIPIENT)
    })
  })

  describe("Lisk", () => {
    const LISK_WETH = "0x4200000000000000000000000000000000000006"

    test("lists in native ETH", () => {
      expect(getListingPaymentToken(Chain.Lisk)).toBe(ZERO_ADDRESS)
    })

    test("offers and wraps in the OP-stack WETH predeploy", () => {
      expect(getOfferPaymentToken(Chain.Lisk)).toBe(LISK_WETH)
      expect(getNativeWrapTokenAddress(Chain.Lisk)).toBe(LISK_WETH)
      expect(getOfferPaymentTokenDecimals(Chain.Lisk)).toBe(18)
    })

    test("uses the standard OpenSea conduit, Seaport, zone and fee recipient", () => {
      expect(usesAlternateProtocol(Chain.Lisk)).toBe(false)
      expect(getDefaultConduit(Chain.Lisk)).toEqual({
        key: OPENSEA_CONDUIT_KEY,
        address: OPENSEA_CONDUIT_ADDRESS,
      })
      expect(getSeaportAddress(Chain.Lisk)).toBe(
        CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
      )
      expect(getSignedZone(Chain.Lisk)).toBe(OPENSEA_SIGNED_ZONE_V2)
      expect(getFeeRecipient(Chain.Lisk)).toBe(OPENSEA_FEE_RECIPIENT)
    })

    test("maps to chain id 1135", () => {
      expect(getChainId(Chain.Lisk)).toBe("1135")
    })
  })

  describe("World Chain", () => {
    test("uses chain ID 480", () => {
      expect(getChainId(Chain.WorldChain)).toBe("480")
    })

    test("lists in native ETH", () => {
      expect(getListingPaymentToken(Chain.WorldChain)).toBe(ZERO_ADDRESS)
      expect(getDefaultPaymentTokenDecimals(Chain.WorldChain)).toEqual({
        [ZERO_ADDRESS]: 18,
        "0x4200000000000000000000000000000000000006": 18,
      })
    })

    test("offers and wraps with the OP-stack WETH predeploy", () => {
      const weth = "0x4200000000000000000000000000000000000006"
      expect(getOfferPaymentToken(Chain.WorldChain)).toBe(weth)
      expect(getOfferPaymentTokenDecimals(Chain.WorldChain)).toBe(18)
      expect(getNativeWrapTokenAddress(Chain.WorldChain)).toBe(weth)
      expect(usesNativeStablecoinOffers(Chain.WorldChain)).toBe(false)
    })

    test("uses the standard OpenSea Seaport, conduit, zone and fee recipient", () => {
      expect(usesAlternateProtocol(Chain.WorldChain)).toBe(false)
      expect(getDefaultConduit(Chain.WorldChain)).toEqual({
        key: OPENSEA_CONDUIT_KEY,
        address: OPENSEA_CONDUIT_ADDRESS,
      })
      expect(getSeaportAddress(Chain.WorldChain)).toBe(
        CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
      )
      expect(getSignedZone(Chain.WorldChain)).toBe(OPENSEA_SIGNED_ZONE_V2)
      expect(getFeeRecipient(Chain.WorldChain)).toBe(OPENSEA_FEE_RECIPIENT)
    })
  })
  describe("Kaia", () => {
    const WKLAY = "0x19aac5f612f524b754ca7e7c41cbfa2e981a4432"

    test("lists in native KAIA", () => {
      expect(getListingPaymentToken(Chain.Kaia)).toBe(ZERO_ADDRESS)
    })

    test("offers in WKLAY (canonical wrapped KAIA)", () => {
      expect(getOfferPaymentToken(Chain.Kaia)).toBe(WKLAY)
    })

    test("wraps native KAIA into WKLAY", () => {
      expect(getNativeWrapTokenAddress(Chain.Kaia)).toBe(WKLAY)
    })

    test("uses 18 decimals for offer and listing tokens", () => {
      expect(getOfferPaymentTokenDecimals(Chain.Kaia)).toBe(18)
      expect(getDefaultPaymentTokenDecimals(Chain.Kaia)).toEqual({
        [WKLAY]: 18,
        [ZERO_ADDRESS]: 18,
      })
    })

    test("uses the default OpenSea conduit", () => {
      const result = getDefaultConduit(Chain.Kaia)
      expect(result.key).toBe(OPENSEA_CONDUIT_KEY)
      expect(result.address).toBe(OPENSEA_CONDUIT_ADDRESS)
    })

    test("uses the canonical Seaport 1.6, signed zone and fee recipient", () => {
      expect(usesAlternateProtocol(Chain.Kaia)).toBe(false)
      expect(getSeaportAddress(Chain.Kaia)).toBe(
        CROSS_CHAIN_SEAPORT_V1_6_ADDRESS,
      )
      expect(getSignedZone(Chain.Kaia)).toBe(OPENSEA_SIGNED_ZONE_V2)
      expect(getFeeRecipient(Chain.Kaia)).toBe(OPENSEA_FEE_RECIPIENT)
    })
  })
})
