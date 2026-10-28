import { describe, expect, test, vi } from "vitest"
import { AssetsManager } from "../../src/sdk/assets"
import type { SDKContext } from "../../src/sdk/context"
import { Chain, EventType, TokenStandard } from "../../src/types"

const TOKEN = "0x0f5d2fb29fb7d3cfee444a200298f468908cc942"
const FROM = "0x0000000000000000000000000000000000000001"

/**
 * batchApproveAssets only touches a handful of context members, so build the
 * minimum and cast. Allowance reads return 0 so every asset looks unapproved.
 */
function harness() {
  let sent = 0
  const sendTransaction = vi.fn(async () => {
    sent += 1
    return { hash: sent === 1 ? "0xtest" : `0xtest${sent}` }
  })
  const writeContract = vi.fn().mockResolvedValue({ hash: "0xmulticall" })
  const encodeFunctionData = vi.fn(
    ({ functionName }: { functionName: string }) => `0x${functionName}`,
  )
  const confirmTransaction = vi.fn().mockResolvedValue(undefined)

  const context = {
    chain: Chain.Mainnet,
    wallet: { signer: { sendTransaction } },
    contractCaller: {
      readContract: vi.fn().mockResolvedValue(0n),
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
    dispatch: (context as unknown as { dispatch: ReturnType<typeof vi.fn> })
      .dispatch,
  }
}

const erc20 = (tokenAddress: string, amount: string) => ({
  asset: { tokenAddress, tokenId: null, tokenStandard: TokenStandard.ERC20 },
  amount,
})

const nft = (
  tokenAddress: string,
  tokenStandard: TokenStandard.ERC721 | TokenStandard.ERC1155,
) => ({
  asset: { tokenAddress, tokenId: "1", tokenStandard },
})

describe("AssetsManager: batchApproveAssets", () => {
  test("sends one approval for the same ERC20 contract, matching case-insensitively", async () => {
    const h = harness()

    await h.manager.batchApproveAssets({
      assets: [erc20(TOKEN, "1"), erc20(TOKEN.toUpperCase(), "2")],
      fromAddress: FROM,
    })

    expect(h.encodeFunctionData).toHaveBeenCalledTimes(1)
    expect(h.sendTransaction).toHaveBeenCalledTimes(1)
    expect(h.writeContract).not.toHaveBeenCalled()
    expect(h.confirmTransaction).toHaveBeenCalledWith(
      "0xtest",
      EventType.ApproveAllAssets,
      "Approving asset for transfer",
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
    expect(h.sendTransaction).toHaveBeenCalledTimes(2)
    expect(h.writeContract).not.toHaveBeenCalled()
  })

  test("sends every approval from the wallet, never through a relay contract", async () => {
    const h = harness()
    const erc721 = "0x2222222222222222222222222222222222222222"
    const erc1155 = "0x3333333333333333333333333333333333333333"

    const hash = await h.manager.batchApproveAssets({
      assets: [
        nft(erc721, TokenStandard.ERC721),
        erc20(TOKEN, "1"),
        nft(erc1155, TokenStandard.ERC1155),
      ],
      fromAddress: FROM,
      overrides: { gasLimit: 100000n },
    })

    // msg.sender must be the wallet: setApprovalForAll/approve key on it, so
    // an approval relayed through Multicall3 would approve Multicall3 instead.
    expect(h.writeContract).not.toHaveBeenCalled()
    expect(h.sendTransaction.mock.calls.map(([tx]) => tx)).toEqual([
      {
        to: erc721,
        data: "0xsetApprovalForAll",
        from: FROM,
        overrides: { gasLimit: 100000n },
      },
      {
        to: TOKEN,
        data: "0xapprove",
        from: FROM,
        overrides: { gasLimit: 100000n },
      },
      {
        to: erc1155,
        data: "0xsetApprovalForAll",
        from: FROM,
        overrides: { gasLimit: 100000n },
      },
    ])
    expect(h.confirmTransaction.mock.calls).toEqual([
      [
        "0xtest",
        EventType.ApproveAllAssets,
        "Approving asset 1 of 3 for transfer",
      ],
      [
        "0xtest2",
        EventType.ApproveAllAssets,
        "Approving asset 2 of 3 for transfer",
      ],
      [
        "0xtest3",
        EventType.ApproveAllAssets,
        "Approving asset 3 of 3 for transfer",
      ],
    ])
    expect(hash).toBe("0xtest3")
  })

  test("waits for each approval to confirm before sending the next", async () => {
    const h = harness()
    const order: string[] = []
    h.sendTransaction.mockImplementation(async () => {
      order.push("send")
      return { hash: "0xtest" }
    })
    h.confirmTransaction.mockImplementation(async () => {
      order.push("confirm")
    })

    await h.manager.batchApproveAssets({
      assets: [
        nft("0x2222222222222222222222222222222222222222", TokenStandard.ERC721),
        erc20(TOKEN, "1"),
      ],
      fromAddress: FROM,
    })

    expect(order).toEqual(["send", "confirm", "send", "confirm"])
  })

  test("stops at the first rejected approval and reports it", async () => {
    const h = harness()
    const rejected = new Error("user rejected")
    h.sendTransaction
      .mockResolvedValueOnce({ hash: "0xtest" })
      .mockRejectedValueOnce(rejected)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      h.manager.batchApproveAssets({
        assets: [
          nft(
            "0x2222222222222222222222222222222222222222",
            TokenStandard.ERC721,
          ),
          erc20(TOKEN, "1"),
          nft(
            "0x3333333333333333333333333333333333333333",
            TokenStandard.ERC1155,
          ),
        ],
        fromAddress: FROM,
      }),
    ).rejects.toBe(rejected)

    expect(h.sendTransaction).toHaveBeenCalledTimes(2)
    expect(h.confirmTransaction).toHaveBeenCalledTimes(1)
    expect(h.dispatch).toHaveBeenCalledWith(EventType.TransactionDenied, {
      error: rejected,
      accountAddress: FROM,
    })
    errorSpy.mockRestore()
  })
})
