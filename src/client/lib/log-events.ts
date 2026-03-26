import type { LogEvent } from "@/contracts";

export const mergeLogEventBySeq = (events: LogEvent[], event: LogEvent): LogEvent[] => {
  if (events.some((current) => current.seq === event.seq)) {
    return events;
  }

  if (events.length === 0 || event.seq > events[events.length - 1]!.seq) {
    return [...events, event];
  }

  const next = [...events];
  const insertAt = next.findIndex((current) => current.seq > event.seq);
  if (insertAt === -1) {
    next.push(event);
  } else {
    next.splice(insertAt, 0, event);
  }
  return next;
};
