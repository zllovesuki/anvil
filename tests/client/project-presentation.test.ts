import { describe, expect, it } from "vitest";

import { inferRepositoryProvider } from "@/client/lib/project-presentation";

describe("project presentation", () => {
  it("shows the full repository hostname", () => {
    expect(inferRepositoryProvider("https://github.com/example/anvil")).toBe("github.com");
    expect(inferRepositoryProvider("https://git-on-cloudflare.com/org/repo")).toBe("git-on-cloudflare.com");
    expect(inferRepositoryProvider("https://git.limic.dev/org/repo")).toBe("git.limic.dev");
  });

  it("normalizes www prefixes and falls back for invalid URLs", () => {
    expect(inferRepositoryProvider("https://www.git.limic.dev/org/repo")).toBe("git.limic.dev");
    expect(inferRepositoryProvider("git-on-cloudflare.com/org/repo")).toBe("custom");
  });
});
