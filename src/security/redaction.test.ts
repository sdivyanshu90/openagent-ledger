import { describe, expect, it } from "vitest";
import { redact } from "./redaction";

describe("redact", () => {
  it("recursively removes sensitive values and bearer credentials", () => {
    const value = redact({
      apiKey: "top-secret",
      nested: [{ authorization: "Bearer abc.123", note: "Bearer xyz" }],
    });
    expect(JSON.stringify(value)).not.toContain("top-secret");
    expect(JSON.stringify(value)).not.toContain("abc.123");
    expect(JSON.stringify(value)).not.toContain("xyz");
    expect(value).toEqual({
      apiKey: "[REDACTED]",
      nested: [{ authorization: "[REDACTED]", note: "[REDACTED]" }],
    });
  });
});
