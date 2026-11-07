import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { longUrlSchema } from "@/lib/validators";

describe("long URL validation", () => {
  beforeAll(() => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://short.example");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("accepts absolute HTTP and HTTPS URLs and trims whitespace", () => {
    expect(longUrlSchema.parse(" https://example.com/path?q=1 ")).toBe(
      "https://example.com/path?q=1",
    );
    expect(longUrlSchema.parse("http://example.org")).toBe("http://example.org");
  });

  it.each([
    ["javascript scheme", "javascript:alert(1)", "URL must use http or https"],
    ["data scheme", "data:text/plain,hello", "URL must use http or https"],
    ["FTP scheme", "ftp://example.com/file", "URL must use http or https"],
    ["missing host", "https://", "Enter a valid URL"],
    ["own short domain", "https://short.example/abc", "URL cannot point to this shortener"],
  ])("rejects a URL with %s", (_description, value, message) => {
    const result = longUrlSchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe(message);
  });

  it("accepts URLs up to 2,048 characters and rejects longer ones", () => {
    const maxLengthUrl = `https://example.com/${"a".repeat(2028)}`;
    expect(maxLengthUrl).toHaveLength(2048);
    expect(longUrlSchema.safeParse(maxLengthUrl).success).toBe(true);
    expect(longUrlSchema.safeParse(`${maxLengthUrl}a`).success).toBe(false);
  });
});
