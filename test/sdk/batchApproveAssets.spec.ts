import { describe, expect, test, vi } from "vitest"
import { OPENSEA_CONDUIT_ADDRESS } from "../../src/constants"
import { AssetsManager } from "../../src/sdk/assets"
import type { SDKContext } from "../../src/sdk/context"
import { Chain, EventType, TokenStandard } from "../../src/types"

const TOKEN = "0x0f5d2fb29fb7d3cfee444a200298f468908cc942"
const FROM = "0x0000000000000000000000000000000000000001"

/**
 * batchApproveAssets only touches a handful of context members, so build the
 * minimum and cast. Allowance reads return 0 so every asset looks unapproved.
 */
function harness(chain: Chain = Chain.Mainnet, allowance = 0n) {
  const sendTransaction = vi.fn().mockResolvedValue({ hash: "0xtest" })
  const writeContract = vi.fn().mockResolvedValue({ hash: "0xmulticall" })
  const encodeFunctionData = vi.fn().mockReturnValue("0xapproval")
  const confirmTransaction = vi.fn().mockResolvedValue(undefined)

  const context = {
    chain,
    wallet: { signer: { sendTransaction } },
    contractCaller: {
      readContract: vi.fn().mockResolvedValue(allowance),
      writeContract,
      encodeFunctionData,
    },
    confirmTransaction,
    requireAccountIsAvailable: vi.fn().mockResolvedValue(undefined),
    dispatch: vi.fn(),
    logger: vi.fn(),
  } as unknown as SDKContext

  return {
    manager: new AssetsManager(context),
    sendTransaction,
    writeContract,
    encodeFunctionData,
    confirmTransaction,
  }
}

const erc20 = (tokenAddress: string, amount: string) => ({
  asset: { tokenAddress, tokenId: null, tokenStandard: TokenStandard.ERC20 },
  amount,
})

describe("AssetsManager: batchApproveAssets", () => {
  test("sends one approval for the same ERC20 contract, matching case-insensitively", async () => {
    const h = harness()

    await h.manager.batchApproveAssets({
      assets: [erc20(TOKEN, "1"), erc20(TOKEN.toUpperCase(), "2")],
      fromAddress: FROM,
    })

    // One approval, so it goes direct rather than through Multicall3.
    expect(h.encodeFunctionData).toHaveBeenCalledTimes(1)
    expect(h.sendTransaction).toHaveBeenCalledTimes(1)
    expect(h.writeContract).not.toHaveBeenCalled()
    expect(h.confirmTransaction).toHaveBeenCalledWith(
      "0xtest",
      EventType.ApproveAllAssets,
      "Approving asset for transfer",
    )
  })

  test("approves the summed requested amount, not an unlimited allowance", async () => {
    const h = harness()

    await h.manager.batchApproveAssets({
      assets: [erc20(TOKEN, "1"), erc20(TOKEN.toUpperCase(), "2")],
      fromAddress: FROM,
    })

    expect(h.encodeFunctionData).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "approve",
        args: [OPENSEA_CONDUIT_ADDRESS, 3n],
      }),
    )
  })

  test("skips the approval when the allowance already covers the summed amount", async () => {
    const h = harness(Chain.Mainnet, 3n)

    const hash = await h.manager.batchApproveAssets({
      assets: [erc20(TOKEN, "1"), erc20(TOKEN, "2")],
      fromAddress: FROM,
    })

    expect(hash).toBeUndefined()
    expect(h.encodeFunctionData).not.toHaveBeenCalled()
    expect(h.sendTransaction).not.toHaveBeenCalled()
  })

  test("approves the canonical OpenSea conduit on Mantle", async () => {
    const h = harness(Chain.Mantle)

    await h.manager.batchApproveAssets({
      assets: [
        erc20(TOKEN, "5"),
        {
          asset: {
            tokenAddress: "0x2222222222222222222222222222222222222222",
            tokenId: "1",
            tokenStandard: TokenStandard.ERC721,
          },
        },
      ],
      fromAddress: FROM,
    })

    expect(h.encodeFunctionData).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "approve",
        args: [OPENSEA_CONDUIT_ADDRESS, 5n],
      }),
    )
    expect(h.encodeFunctionData).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "setApprovalForAll",
        args: [OPENSEA_CONDUIT_ADDRESS, true],
      }),
    )
  })

  test("still sends one approval per distinct ERC20 contract", async () => {
    const h = harness()
    const other = "0x1111111111111111111111111111111111111111"

    await h.manager.batchApproveAssets({
      assets: [erc20(TOKEN, "1"), erc20(other, "2")],
      fromAddress: FROM,
    })

    expect(h.encodeFunctionData).toHaveBeenCalledTimes(2)
    // Two approvals batch through Multicall3 instead of going direct.
    expect(h.writeContract).toHaveBeenCalledTimes(1)
    expect(h.sendTransaction).not.toHaveBeenCalled()
  })
})
