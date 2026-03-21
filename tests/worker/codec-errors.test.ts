import { EnGardeAssertionError } from "@cloudflare/util-en-garde";
import { describe, expect, it } from "vitest";

import { formatApiError } from "@/client/lib/api";
import { ApiError } from "@/client/lib/api-contract";
import { BranchName } from "@/contracts";
import { formatCodecIssues, toCodecIssueDetails } from "@/lib/codec-errors";
import { parseRepoConfigFile } from "@/worker/sandbox/repo-config";

describe("codec error helpers", () => {
  it("formats branded assertDecode failures into readable messages", () => {
    let error: unknown;

    try {
      BranchName.assertDecode("");
    } catch (caught) {
      error = caught;
    }

    expect(formatCodecIssues(error)).toBe("value: expected BranchName");
    expect(formatApiError(error)).toBe("value: expected BranchName");
    expect(toCodecIssueDetails(error)).toEqual({
      issues: [
        {
          path: "",
          expected: "BranchName",
          message: null,
        },
      ],
    });
  });

  it("preserves issue messages like expectedTrusted", () => {
    const error = new EnGardeAssertionError([
      {
        context: [
          { key: "", type: { name: "Root" } },
          { key: "branch", type: { name: "BranchName" } },
        ],
        message: "expectedTrusted",
      } as never,
    ]);

    expect(formatCodecIssues(error)).toBe("branch: expectedTrusted");
    expect(
      formatApiError(
        new ApiError(400, "invalid_request", "Request body failed validation.", toCodecIssueDetails(error)),
      ),
    ).toBe("branch: expectedTrusted");
  });

  it("uses codec issue summaries for repo-config validation errors", () => {
    expect(() =>
      parseRepoConfigFile(`version: 1
checkout: {}
run:
  workingDirectory: ../bad
  timeoutSeconds: 60
  steps:
    - name: Build
      run: npm test
`),
    ).toThrowError(/Repository config failed validation: run\.workingDirectory: expected RepoRelativePath/u);
  });
});
