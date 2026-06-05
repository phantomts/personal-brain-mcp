/**
 * Smoke tests. Real DB integration tests are intentionally omitted from
 * this scaffold — set up a test Supabase project and add them in CI later.
 */
import { describe, it, expect } from "vitest";

describe("scaffold sanity", () => {
  it("imports without throwing", async () => {
    const mod = await import("../src/lib/errors");
    expect(typeof mod.ok).toBe("function");
    expect(mod.ok("hi").content[0]!.text).toBe("hi");
  });
});
