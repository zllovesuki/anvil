import { describe, expect, it } from "vitest";

import { LogEvent } from "@/contracts";
import { mergeLogEventBySeq } from "@/client/lib";

const makeEvent = (seq: number) =>
  LogEvent.assertDecode({
    id: `run_test:log:${seq}`,
    runId: "run_0000000000000000000000",
    seq,
    stream: "stdout",
    chunk: `line ${seq}\n`,
    createdAt: "2026-03-26T00:00:00.000Z",
  });

describe("mergeLogEventBySeq", () => {
  it("appends newer events at the tail", () => {
    expect(mergeLogEventBySeq([makeEvent(1), makeEvent(2)], makeEvent(3)).map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it("inserts older out-of-order events into the correct slot", () => {
    expect(mergeLogEventBySeq([makeEvent(1), makeEvent(4)], makeEvent(2)).map((event) => event.seq)).toEqual([1, 2, 4]);
    expect(
      mergeLogEventBySeq([makeEvent(1), makeEvent(2), makeEvent(5)], makeEvent(4)).map((event) => event.seq),
    ).toEqual([1, 2, 4, 5]);
  });

  it("ignores duplicate seq values", () => {
    const existing = [makeEvent(1), makeEvent(2)];
    expect(mergeLogEventBySeq(existing, makeEvent(2))).toBe(existing);
  });
});
