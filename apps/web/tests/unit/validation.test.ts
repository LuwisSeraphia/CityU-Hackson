import { describe, expect, it } from "vitest";
import { validateMessage } from "@/lib/validation";
describe("composer validation", () => {
  it("rejects whitespace and overly long text", () => {
    expect(validateMessage(" \n ")).toBeTruthy();
    expect(validateMessage("记".repeat(4001))).toBeTruthy();
  });
  it("accepts Chinese and multiline input at the boundary", () => {
    expect(validateMessage("记".repeat(4000))).toBeUndefined();
    expect(validateMessage("今天的想法\n明天继续")).toBeUndefined();
  });
});
