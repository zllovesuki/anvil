import { describe, expect, it } from "vitest";

import { canUseMockAuthMode, resolveAuthModeForHost } from "@/client/lib";

describe("client auth mode policy", () => {
  it("allows mock mode on localhost hosts", () => {
    expect(canUseMockAuthMode("localhost")).toBe(true);
    expect(canUseMockAuthMode("127.0.0.1")).toBe(true);
  });

  it("forces live mode off localhost", () => {
    expect(canUseMockAuthMode("anvil.example.com")).toBe(false);
    expect(resolveAuthModeForHost("anvil.example.com", "mock")).toBe("live");
    expect(resolveAuthModeForHost("anvil.example.com", "live")).toBe("live");
  });

  it("preserves the stored mode on localhost", () => {
    expect(resolveAuthModeForHost("localhost", "mock")).toBe("mock");
    expect(resolveAuthModeForHost("localhost", "live")).toBe("live");
  });
});
