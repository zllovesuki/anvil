const DISPOSE_SYMBOL = Symbol.dispose ?? Symbol.for("Symbol.dispose");

export const disposeRpcStub = (value: unknown): void => {
  if (typeof value !== "object" || value === null) {
    return;
  }

  const invokeDispose = (dispose: () => unknown): void => {
    try {
      const result = dispose();
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        void Promise.resolve(result).catch(() => {});
      }
    } catch {}
  };

  try {
    const symbolDispose =
      DISPOSE_SYMBOL in value ? (value as { [DISPOSE_SYMBOL]?: unknown })[DISPOSE_SYMBOL] : undefined;
    if (typeof symbolDispose === "function") {
      invokeDispose(() => symbolDispose.call(value));
      return;
    }

    const dispose = "dispose" in value ? (value as { dispose?: unknown }).dispose : undefined;
    if (typeof dispose === "function") {
      invokeDispose(() => dispose.call(value));
    }
  } catch {}
};
