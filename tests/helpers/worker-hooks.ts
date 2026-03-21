import { afterEach, beforeEach } from "vitest";

import { applyAppMigrations, drainProjectDoAlarms } from "./runtime";

export const registerWorkerRuntimeHooks = (): void => {
  beforeEach(async () => {
    await applyAppMigrations();
  });

  afterEach(async () => {
    await drainProjectDoAlarms();
  });
};
