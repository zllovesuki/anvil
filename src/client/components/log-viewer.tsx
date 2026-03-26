import { ArrowDown, ChevronDown, ChevronUp, Search, WrapText, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { LogEvent, LogStream } from "@/contracts";
import { createAnsiProcessor, type AnsiProcessor, type AnsiSpan } from "@/client/lib";
import { isLogViewerPinnedToLatest } from "@/client/components/log-viewer-scroll";

const STREAM_COLORS: Record<string, string> = {
  stdout: "text-zinc-300",
  stderr: "text-red-400",
  system: "text-accent-400",
};

const STREAM_DOT: Record<string, string> = {
  stdout: "bg-zinc-400",
  stderr: "bg-red-400",
  system: "bg-accent-400",
};

const CONNECTION_DOT: Record<string, string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-500 animate-pulse",
  reconnecting: "bg-amber-500 animate-pulse",
  closed: "bg-zinc-500",
  idle: "bg-zinc-500",
};

const ALL_STREAMS: readonly LogStream[] = ["stdout", "stderr", "system"];
const BASE_PADDING_BOTTOM_PX = 16;
const JUMP_PADDING_BOTTOM_PX = 48;

interface HighlightRange {
  start: number;
  end: number;
  matchIndex: number;
}

interface FilteredEntry {
  log: LogEvent;
  spans: AnsiSpan[];
  index: number;
}

interface ProcessedLogCache {
  proc: AnsiProcessor;
  results: AnsiSpan[][];
  firstId: string | null;
  lastId: string | null;
}

interface MatchPosition {
  entryIndex: number;
  charStart: number;
  charEnd: number;
}

const isUnstyled = (s: AnsiSpan) =>
  !s.fg && !s.bg && !s.bold && !s.dim && !s.italic && !s.underline && !s.strikethrough;

const spanStyle = (span: AnsiSpan): React.CSSProperties | undefined => {
  if (isUnstyled(span)) return undefined;
  const s: React.CSSProperties = {};
  if (span.fg) s.color = span.fg;
  if (span.bg) s.backgroundColor = span.bg;
  if (span.bold) s.fontWeight = "bold";
  if (span.dim) s.opacity = 0.5;
  if (span.italic) s.fontStyle = "italic";
  const deco = [span.underline && "underline", span.strikethrough && "line-through"].filter(Boolean).join(" ");
  if (deco) s.textDecorationLine = deco;
  return s;
};

const canAppendProcessedLogs = (cache: ProcessedLogCache, logs: LogEvent[]) => {
  if (cache.results.length === 0 || logs.length <= cache.results.length) {
    return false;
  }

  if (logs[0]!.id !== cache.firstId) {
    return false;
  }

  return logs[cache.results.length - 1]!.id === cache.lastId;
};

/**
 * Render a single chunk's ANSI spans, optionally splitting them at search
 * highlight boundaries.
 */
const AnsiLine = memo(
  function AnsiLine({
    spans,
    className,
    highlights,
    currentMatchIndex,
  }: {
    spans: AnsiSpan[];
    className: string;
    highlights?: HighlightRange[];
    currentMatchIndex?: number;
  }) {
    // Fast path: no highlights, single unstyled span
    if (!highlights && spans.length === 1 && isUnstyled(spans[0]!)) {
      return <span className={className}>{spans[0]!.text}</span>;
    }

    // No highlights — render spans without splitting
    if (!highlights) {
      return (
        <span className={className}>
          {spans.map((span, i) => {
            const s = spanStyle(span);
            return s ? (
              <span key={i} style={s}>
                {span.text}
              </span>
            ) : (
              span.text
            );
          })}
        </span>
      );
    }

    // With highlights — split spans at highlight boundaries
    const elements: React.ReactNode[] = [];
    let charOffset = 0;
    let hi = 0; // highlight pointer
    let key = 0;

    for (const span of spans) {
      const s = spanStyle(span);
      const spanEnd = charOffset + span.text.length;
      let pos = 0; // position within span.text

      while (pos < span.text.length && hi < highlights.length) {
        const h = highlights[hi]!;
        const absPos = charOffset + pos;

        // Before highlight start — emit plain segment
        if (absPos < h.start) {
          const segEnd = Math.min(span.text.length, h.start - charOffset);
          const seg = span.text.slice(pos, segEnd);
          if (seg)
            elements.push(
              s ? (
                <span key={key++} style={s}>
                  {seg}
                </span>
              ) : (
                seg
              ),
            );
          pos = segEnd;
          continue;
        }

        // Inside highlight — emit marked segment
        if (absPos < h.end) {
          const segEnd = Math.min(span.text.length, h.end - charOffset);
          const seg = span.text.slice(pos, segEnd);
          if (seg) {
            elements.push(
              <mark
                key={key++}
                className={
                  h.matchIndex === currentMatchIndex
                    ? "rounded-sm bg-amber-400/40 text-inherit ring-1 ring-amber-400/60"
                    : "rounded-sm bg-amber-500/25 text-inherit"
                }
                style={s}
              >
                {seg}
              </mark>,
            );
          }
          pos = segEnd;
          if (charOffset + pos >= h.end) hi++;
          continue;
        }

        // Past this highlight — advance
        hi++;
      }

      // Remaining text after all highlights
      if (pos < span.text.length) {
        const seg = span.text.slice(pos);
        elements.push(
          s ? (
            <span key={key++} style={s}>
              {seg}
            </span>
          ) : (
            seg
          ),
        );
      }

      charOffset = spanEnd;
    }

    return <span className={className}>{elements}</span>;
  },
  (prev, next) => {
    if (prev.spans !== next.spans || prev.className !== next.className) return false;
    if (prev.highlights !== next.highlights) return false;
    if (!prev.highlights) return true;
    if (prev.currentMatchIndex === next.currentMatchIndex) return true;
    const affects = (idx: number | undefined) =>
      idx !== undefined && prev.highlights!.some((h) => h.matchIndex === idx);
    return !affects(prev.currentMatchIndex) && !affects(next.currentMatchIndex);
  },
);

/** Search bar – owns local input state + debounce; parent only sees the settled query. */
const SearchBar = memo(function SearchBar({
  searchActive,
  matchCount,
  currentMatchIndex,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
}: {
  searchActive: boolean;
  matchCount: number;
  currentMatchIndex: number;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query) {
      onQueryChange("");
      return;
    }
    debounceRef.current = setTimeout(() => onQueryChange(query), 500);
    return () => clearTimeout(debounceRef.current);
  }, [query, onQueryChange]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) onPrev();
        else onNext();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onNext, onPrev, onClose],
  );

  return (
    <div
      role="search"
      aria-label="Search logs"
      className="flex items-center gap-1.5 border-t border-zinc-800/40 px-4 py-1.5"
    >
      <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search logs..."
        className="min-w-0 flex-1 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-600 outline-none"
        aria-label="Search log text"
      />
      {searchActive ? (
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-500" aria-live="polite">
          {matchCount > 0 ? `${currentMatchIndex + 1} of ${matchCount}` : "No matches"}
        </span>
      ) : null}
      <button
        type="button"
        aria-label="Previous match"
        onClick={onPrev}
        disabled={matchCount === 0}
        className="rounded p-0.5 text-zinc-500 hover:text-zinc-300 disabled:opacity-30"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="Next match"
        onClick={onNext}
        disabled={matchCount === 0}
        className="rounded p-0.5 text-zinc-500 hover:text-zinc-300 disabled:opacity-30"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className="rounded p-0.5 text-zinc-500 hover:text-zinc-300"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});

const LogViewer = memo(function LogViewer({ logs, logStreamStatus }: { logs: LogEvent[]; logStreamStatus: string }) {
  // -- Refs ----------------------------------------------------------------
  const logContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const scrollingToBottomRef = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  const matchLineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const paddingBottomRef = useRef(BASE_PADDING_BOTTOM_PX);

  // -- Scroll state --------------------------------------------------------
  const [atBottom, setAtBottom] = useState(true);

  const handleScroll = useCallback(() => {
    const container = logContainerRef.current;
    if (!container) return;
    const isAtBottom = isLogViewerPinnedToLatest({
      scrollTop: container.scrollTop,
      clientHeight: container.clientHeight,
      scrollHeight: container.scrollHeight,
      paddingBottom: paddingBottomRef.current,
    });
    setAtBottom(isAtBottom);

    if (isAtBottom) {
      scrollingToBottomRef.current = false;
      autoScrollRef.current = true;
      return;
    }

    if (!scrollingToBottomRef.current) {
      autoScrollRef.current = false;
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = logContainerRef.current;
    if (!container) return;
    scrollingToBottomRef.current = true;
    autoScrollRef.current = true;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, []);

  const handleScrollTakeover = useCallback(() => {
    if (!scrollingToBottomRef.current) return;
    const container = logContainerRef.current;
    scrollingToBottomRef.current = false;
    if (!container) {
      autoScrollRef.current = false;
      return;
    }

    const isAtBottom = isLogViewerPinnedToLatest({
      scrollTop: container.scrollTop,
      clientHeight: container.clientHeight,
      scrollHeight: container.scrollHeight,
      paddingBottom: paddingBottomRef.current,
    });
    setAtBottom(isAtBottom);
    autoScrollRef.current = isAtBottom;
  }, []);

  // Auto-scroll on new logs
  useLayoutEffect(() => {
    const container = logContainerRef.current;
    if (!container || !autoScrollRef.current) return;
    container.scrollTop = container.scrollHeight;
    const isAtBottom = isLogViewerPinnedToLatest({
      scrollTop: container.scrollTop,
      clientHeight: container.clientHeight,
      scrollHeight: container.scrollHeight,
      paddingBottom: paddingBottomRef.current,
    });
    setAtBottom(isAtBottom);
    if (isAtBottom) {
      scrollingToBottomRef.current = false;
    }
  }, [logs]);

  // -- Incremental ANSI processing -----------------------------------------
  const processorRef = useRef<ProcessedLogCache>({
    proc: createAnsiProcessor(),
    results: [],
    firstId: null,
    lastId: null,
  });

  // Incremental processing — imperative ref update (idempotent, StrictMode-safe)
  const cache = processorRef.current;
  if (logs.length === 0) {
    if (cache.results.length > 0) {
      processorRef.current = { proc: createAnsiProcessor(), results: [], firstId: null, lastId: null };
    }
  } else if (
    cache.firstId === logs[0]!.id &&
    cache.lastId === logs[logs.length - 1]!.id &&
    cache.results.length === logs.length
  ) {
    // Already fully processed (double-invocation or unchanged logs) — no-op
  } else if (canAppendProcessedLogs(cache, logs)) {
    for (let i = cache.results.length; i < logs.length; i++) {
      cache.results.push(cache.proc.feed(logs[i]!.chunk));
    }
    cache.lastId = logs[logs.length - 1]!.id;
  } else {
    const proc = createAnsiProcessor();
    const results = logs.map((log) => proc.feed(log.chunk));
    processorRef.current = { proc, results, firstId: logs[0]!.id, lastId: logs[logs.length - 1]!.id };
  }
  const processedLogs = processorRef.current.results;

  // -- Stream filtering ----------------------------------------------------
  const [visibleStreams, setVisibleStreams] = useState<Set<LogStream>>(new Set(ALL_STREAMS));

  const streamCounts = useMemo(() => {
    const counts: Record<string, number> = { stdout: 0, stderr: 0, system: 0 };
    for (const log of logs) counts[log.stream]++;
    return counts;
  }, [logs]);

  const toggleStream = useCallback((stream: LogStream) => {
    setVisibleStreams((prev) => {
      const next = new Set(prev);
      if (next.has(stream)) next.delete(stream);
      else next.add(stream);
      return next;
    });
  }, []);

  const filteredEntries = useMemo(() => {
    const entries: FilteredEntry[] = [];
    for (let i = 0; i < logs.length; i++) {
      if (visibleStreams.has(logs[i]!.stream)) {
        entries.push({ log: logs[i]!, spans: processedLogs[i]!, index: i });
      }
    }
    return entries;
  }, [logs, processedLogs, visibleStreams]);

  // -- Text wrap -----------------------------------------------------------
  const [textWrap, setTextWrap] = useState(true);

  // -- Search --------------------------------------------------------------
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const searchMatches = useMemo(() => {
    if (!searchQuery) return [];
    const matches: MatchPosition[] = [];
    const needle = searchQuery.toLowerCase();
    for (let ei = 0; ei < filteredEntries.length; ei++) {
      const text = filteredEntries[ei]!.spans.map((s) => s.text)
        .join("")
        .toLowerCase();
      let pos = 0;
      while (pos <= text.length - needle.length) {
        const idx = text.indexOf(needle, pos);
        if (idx === -1) break;
        matches.push({ entryIndex: ei, charStart: idx, charEnd: idx + needle.length });
        pos = idx + 1;
      }
    }
    return matches;
  }, [filteredEntries, searchQuery]);

  // Clamp match index
  useEffect(() => {
    if (searchMatches.length === 0) {
      setCurrentMatchIndex(0);
    } else if (currentMatchIndex >= searchMatches.length) {
      setCurrentMatchIndex(searchMatches.length - 1);
    }
  }, [searchMatches.length, currentMatchIndex]);

  // Scroll to current match
  useEffect(() => {
    if (searchMatches.length === 0) return;
    const match = searchMatches[currentMatchIndex];
    if (!match) return;
    const el = matchLineRefs.current.get(match.entryIndex);
    if (el) {
      scrollingToBottomRef.current = false;
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      autoScrollRef.current = false;
    }
  }, [currentMatchIndex, searchMatches]);

  // Highlight map: entryIndex → HighlightRange[] (stable across match navigation)
  const lineHighlights = useMemo(() => {
    if (!searchQuery || searchMatches.length === 0) return null;
    const map = new Map<number, HighlightRange[]>();
    for (let mi = 0; mi < searchMatches.length; mi++) {
      const m = searchMatches[mi]!;
      let list = map.get(m.entryIndex);
      if (!list) {
        list = [];
        map.set(m.entryIndex, list);
      }
      list.push({ start: m.charStart, end: m.charEnd, matchIndex: mi });
    }
    return map;
  }, [searchQuery, searchMatches]);

  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    setCurrentMatchIndex((i) => (i + 1) % searchMatches.length);
  }, [searchMatches.length]);

  const goToPrevMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    setCurrentMatchIndex((i) => (i - 1 + searchMatches.length) % searchMatches.length);
  }, [searchMatches.length]);

  const openSearch = useCallback(() => setSearchOpen(true), []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setCurrentMatchIndex(0);
    matchLineRefs.current.clear();
  }, []);

  const handleQueryChange = useCallback((q: string) => {
    setSearchQuery(q);
    setCurrentMatchIndex(0);
  }, []);

  // Ctrl/Cmd+F shortcut (guarded to viewport)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        const section = sectionRef.current;
        if (!section) return;
        const rect = section.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        e.preventDefault();
        openSearch();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [openSearch]);

  // -- Render --------------------------------------------------------------
  const showJumpButton = !atBottom && filteredEntries.length > 0;
  paddingBottomRef.current = showJumpButton ? JUMP_PADDING_BOTTOM_PX : BASE_PADDING_BOTTOM_PX;

  return (
    <section
      ref={sectionRef}
      className="flex min-h-[400px] max-h-[60vh] flex-col overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-950/60 sm:max-h-[70vh] lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)]"
    >
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-800/60">
        {/* Top row: title + search icon + connection status */}
        <div className="flex items-center gap-3 px-4 py-2">
          <h2 className="text-sm font-semibold text-zinc-100">Logs</h2>

          {/* Stream filter chips */}
          <div className="flex items-center gap-1.5" role="group" aria-label="Filter by stream">
            {ALL_STREAMS.map((stream) => {
              const active = visibleStreams.has(stream);
              return (
                <button
                  key={stream}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${stream} logs (${streamCounts[stream] ?? 0})`}
                  onClick={() => toggleStream(stream)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                    active
                      ? "border-zinc-600 bg-zinc-800 text-zinc-300"
                      : "border-zinc-800/60 bg-transparent text-zinc-600"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${STREAM_DOT[stream] ?? "bg-zinc-500"}`} />
                  {stream}
                  <span className="tabular-nums text-zinc-500">{streamCounts[stream] ?? 0}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1" />

          {/* Search toggle */}
          {!searchOpen ? (
            <button
              type="button"
              aria-label="Search logs"
              onClick={openSearch}
              className="rounded p-1 text-zinc-500 hover:text-zinc-300"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          ) : null}

          {/* Wrap toggle */}
          <button
            type="button"
            aria-pressed={textWrap}
            aria-label="Toggle text wrap"
            onClick={() => setTextWrap((v) => !v)}
            className={`rounded p-1 ${textWrap ? "text-zinc-300" : "text-zinc-500"} hover:text-zinc-300`}
          >
            <WrapText className="h-3.5 w-3.5" />
          </button>

          {/* Connection status */}
          <span className="inline-flex items-center gap-2 text-xs text-zinc-500">
            <span className={`h-2 w-2 rounded-full ${CONNECTION_DOT[logStreamStatus] ?? "bg-zinc-500"}`} />
            {logStreamStatus}
          </span>
        </div>

        {/* Search bar (separate row when open) */}
        {searchOpen ? (
          <SearchBar
            searchActive={searchQuery !== ""}
            matchCount={searchMatches.length}
            currentMatchIndex={currentMatchIndex}
            onQueryChange={handleQueryChange}
            onNext={goToNextMatch}
            onPrev={goToPrevMatch}
            onClose={closeSearch}
          />
        ) : null}
      </div>

      {/* Log scroll area + jump-to-bottom */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={logContainerRef}
          onScroll={handleScroll}
          onPointerDown={handleScrollTakeover}
          onTouchStart={handleScrollTakeover}
          onWheel={handleScrollTakeover}
          className={`h-full overflow-auto p-4 font-mono text-xs leading-5 ${showJumpButton ? "pb-12" : ""}`}
        >
          {filteredEntries.length === 0 ? (
            <p className="text-zinc-600">
              {logs.length === 0 ? "No log output yet." : "No logs match the current filters."}
            </p>
          ) : (
            filteredEntries.map((entry, i) => (
              <div
                key={entry.log.id}
                ref={
                  searchOpen
                    ? (el: HTMLDivElement | null) => {
                        if (el) matchLineRefs.current.set(i, el);
                        else matchLineRefs.current.delete(i);
                      }
                    : undefined
                }
                className={`flex gap-3${textWrap ? " min-w-0" : " whitespace-nowrap"}`}
              >
                <span className="w-8 shrink-0 select-none text-right text-zinc-600">{entry.log.seq}</span>
                <AnsiLine
                  spans={entry.spans}
                  className={`${STREAM_COLORS[entry.log.stream] ?? "text-zinc-300"}${textWrap ? " break-all" : ""}`}
                  highlights={lineHighlights?.get(i)}
                  currentMatchIndex={currentMatchIndex}
                />
              </div>
            ))
          )}
        </div>

        {/* Jump to bottom */}
        {showJumpButton ? (
          <button
            type="button"
            aria-label="Scroll to latest logs"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/90 px-3 py-1.5 text-xs font-medium text-zinc-300 shadow-lg backdrop-blur-sm transition-opacity hover:bg-zinc-700/60 hover:text-zinc-100 max-sm:inset-x-3 max-sm:right-auto"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Latest
          </button>
        ) : null}
      </div>
    </section>
  );
});

export { LogViewer };
