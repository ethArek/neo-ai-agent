import { positiveDecimalAmountSchema } from "../src/core/validation";

describe("positiveDecimalAmountSchema", () => {
  it("accepts very large decimal strings without Number coercion", () => {
    expect(
      positiveDecimalAmountSchema.parse(
        "999999999999999999999999999999999999999999999999999999999999",
      ),
    ).toBe("999999999999999999999999999999999999999999999999999999999999");
  });

  it("rejects zero-valued decimal strings", () => {
    expect(positiveDecimalAmountSchema.safeParse("0").success).toBe(false);
    expect(positiveDecimalAmountSchema.safeParse("0.0").success).toBe(false);
    expect(positiveDecimalAmountSchema.safeParse("0.000000").success).toBe(
      false,
    );
  });

  it("accepts tiny positive decimal strings", () => {
    expect(positiveDecimalAmountSchema.parse("0.0000000001")).toBe(
      "0.0000000001",
    );
  });
});
