import { describe, expect, test } from "vitest"
import { parseEther, parseUnits } from "../../src/utils/units"

describe("parseUnits", () => {
  test("parses integer value", () => {
    expect(parseUnits("1", 18)).toBe(1000000000000000000n)
  })

  test("parses decimal value", () => {
    expect(parseUnits("1.5", 18)).toBe(1500000000000000000n)
  })

  test("parses zero", () => {
    expect(parseUnits("0", 18)).toBe(0n)
  })

  test("pads fractional part when shorter than decimals", () => {
    expect(parseUnits("1.1", 18)).toBe(1100000000000000000n)
  })

  test("throws when fractional part exceeds decimals", () => {
    expect(() => parseUnits("1.1234567", 6)).toThrow("Too many decimal places")
  })

  test("handles 6 decimals (USDC)", () => {
    expect(parseUnits("100", 6)).toBe(100000000n)
    expect(parseUnits("1.5", 6)).toBe(1500000n)
  })

  test("handles 0 decimals", () => {
    expect(parseUnits("42", 0)).toBe(42n)
  })

  test("handles negative values", () => {
    expect(parseUnits("-1", 18)).toBe(-1000000000000000000n)
  })

  test("handles bigint input", () => {
    expect(parseUnits(5n, 18)).toBe(5000000000000000000n)
  })

  test("handles number input", () => {
    expect(parseUnits(3, 18)).toBe(3000000000000000000n)
  })

  test("handles JavaScript scientific notation (small numbers)", () => {
    // 1e-8 in JS becomes "1e-8" string via toString()
    expect(parseUnits(1e-8, 18)).toBe(10000000000n)
  })

  test("handles string scientific notation", () => {
    // Any caller that stringifies an amount before parsing it lands here:
    // String(1e-8) is "1e-8", which used to reach BigInt intact and throw
    // "Cannot convert 1e-8000000000000000000 to a BigInt".
    expect(parseUnits("1e-8", 18)).toBe(10000000000n)
    expect(parseUnits("1.5e-5", 18)).toBe(15000000000000n)
    expect(parseUnits("1E-6", 6)).toBe(1n)
    expect(parseUnits("2e3", 18)).toBe(2000000000000000000000n)
    expect(parseUnits("-1e-8", 18)).toBe(-10000000000n)
    expect(parseUnits("1e+2", 0)).toBe(100n)
  })

  test("expands scientific notation exactly, without float rounding", () => {
    // Going through Number.toFixed would return 1000000000000000019884624838656
    // for this, and exponential notation rather than digits at or above 1e21.
    expect(parseUnits("1e30", 0)).toBe(1000000000000000000000000000000n)
    expect(parseUnits("1.234567890123456789e18", 0)).toBe(1234567890123456789n)
  })

  test("throws rather than truncating a value below the token's precision", () => {
    // toFixed(6) would render 1e-8 as "0.000000", silently parsing a nonzero
    // amount as zero.
    expect(() => parseUnits("1e-8", 6)).toThrow("Too many decimal places")
  })

  test("throws for invalid decimal (multiple dots)", () => {
    expect(() => parseUnits("1.2.3", 18)).toThrow("Invalid decimal value")
  })

  test("throws for non-numeric input instead of failing inside BigInt", () => {
    expect(() => parseUnits("abc", 18)).toThrow("Invalid decimal value")
    expect(() => parseUnits("", 18)).toThrow("Invalid decimal value")
    expect(() => parseUnits("1e", 18)).toThrow("Invalid decimal value")
    expect(() => parseUnits("e5", 18)).toThrow("Invalid decimal value")
    expect(() => parseUnits(Number.NaN, 18)).toThrow("Invalid decimal value")
    expect(() => parseUnits(Number.POSITIVE_INFINITY, 18)).toThrow(
      "Invalid decimal value",
    )
  })

  test("rejects huge exponents without expanding them", () => {
    const inputs = [
      "1e300000000",
      "1e-500000000",
      "1e+999999999999999999999",
      "-1.5E-300000000",
      "1e513",
      "1e-513",
    ]
    for (const input of inputs) {
      const start = performance.now()
      expect(() => parseUnits(input, 18)).toThrow("Invalid decimal value")
      expect(performance.now() - start).toBeLessThan(50)
    }
  })

  test("rejects overlong digit strings before parsing them", () => {
    const start = performance.now()
    expect(() => parseUnits("1".repeat(1_000_000), 18)).toThrow(
      "Invalid decimal value",
    )
    const tinyFraction = `0.${"0".repeat(1_000_000)}1`
    expect(() => parseUnits(tinyFraction, 18)).toThrow("Invalid decimal value")
    expect(performance.now() - start).toBeLessThan(50)
  })

  test("still parses the largest real amounts exactly", () => {
    const maxUint256 = 2n ** 256n - 1n
    expect(parseUnits(maxUint256.toString(), 0)).toBe(maxUint256)
    expect(parseUnits(maxUint256, 18)).toBe(maxUint256 * 10n ** 18n)
    expect(parseUnits("1e77", 0)).toBe(10n ** 77n)
    expect(parseUnits("1e-255", 255)).toBe(1n)
    expect(parseUnits(`0.${"0".repeat(254)}1`, 255)).toBe(1n)
    expect(parseUnits(1e21, 18)).toBe(10n ** 39n)
    expect(parseUnits("1e-8", 18)).toBe(10000000000n)
  })
})

describe("parseEther", () => {
  test("parses 1 ETH", () => {
    expect(parseEther("1")).toBe(1000000000000000000n)
  })

  test("parses 0.5 ETH", () => {
    expect(parseEther("0.5")).toBe(500000000000000000n)
  })

  test("parses small amount", () => {
    expect(parseEther("0.000000000000000001")).toBe(1n)
  })
})
