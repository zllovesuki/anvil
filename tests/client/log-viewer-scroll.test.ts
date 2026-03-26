import { describe, expect, it } from "vitest";

import { isLogViewerPinnedToLatest } from "@/client/components/log-viewer-scroll";

describe("LogViewer pinned-bottom detection", () => {
  it("treats a near-bottom position as pinned with normal padding", () => {
    expect(
      isLogViewerPinnedToLatest({
        scrollTop: 785,
        clientHeight: 400,
        scrollHeight: 1200,
        paddingBottom: 16,
      }),
    ).toBe(true);
  });

  it("treats the jump-button gutter as valid bottom space", () => {
    expect(
      isLogViewerPinnedToLatest({
        scrollTop: 752,
        clientHeight: 400,
        scrollHeight: 1200,
        paddingBottom: 48,
      }),
    ).toBe(true);
  });

  it("does not treat a materially larger gap as pinned", () => {
    expect(
      isLogViewerPinnedToLatest({
        scrollTop: 720,
        clientHeight: 400,
        scrollHeight: 1200,
        paddingBottom: 48,
      }),
    ).toBe(false);
  });
});
