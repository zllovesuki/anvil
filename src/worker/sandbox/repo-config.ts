import { parse as parseYaml } from "yaml";

import { RepoConfig, RepoConfigFileText } from "@/worker/contracts";
import { formatCodecIssues } from "@/lib/codec-errors";

export const parseRepoConfigFile = (text: string): RepoConfig => {
  let boundedText: string;

  try {
    boundedText = RepoConfigFileText.assertDecode(text);
  } catch (error) {
    const detail = formatCodecIssues(error) ?? (error instanceof Error ? error.message : String(error));
    throw new Error(`Repository config failed size validation: ${detail}`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(boundedText) as unknown;
  } catch (error) {
    throw new Error(`Repository config is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    return RepoConfig.assertDecode(parsed);
  } catch (error) {
    const detail = formatCodecIssues(error) ?? (error instanceof Error ? error.message : String(error));
    throw new Error(`Repository config failed validation: ${detail}`);
  }
};

export const resolveWorkingDirectory = (repoRoot: string, workingDirectory: string): string =>
  workingDirectory === "." ? repoRoot : `${repoRoot}/${workingDirectory}`;
