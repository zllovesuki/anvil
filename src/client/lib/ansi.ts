import { parse, type CODE } from "@ansi-tools/parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnsiSpan {
  text: string;
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

export interface AnsiProcessor {
  feed(chunk: string): AnsiSpan[];
}

// ---------------------------------------------------------------------------
// 16-color palette – tuned for dark bg (zinc-950)
// ---------------------------------------------------------------------------

const COLORS_16: readonly string[] = [
  "#3f3f46", // 0  black        (zinc-700)
  "#f87171", // 1  red          (red-400)
  "#4ade80", // 2  green        (green-400)
  "#facc15", // 3  yellow       (yellow-400)
  "#60a5fa", // 4  blue         (blue-400)
  "#c084fc", // 5  magenta      (purple-400)
  "#22d3ee", // 6  cyan         (cyan-400)
  "#d4d4d8", // 7  white        (zinc-300)
  "#71717a", // 8  bright black (zinc-500)
  "#fca5a5", // 9  bright red   (red-300)
  "#86efac", // 10 bright green (green-300)
  "#fde047", // 11 bright yellow(yellow-300)
  "#93c5fd", // 12 bright blue  (blue-300)
  "#d8b4fe", // 13 bright mag.  (purple-300)
  "#67e8f9", // 14 bright cyan  (cyan-300)
  "#fafafa", // 15 bright white (zinc-50)
];

function color256(n: number): string | null {
  if (n < 0 || n > 255) return null;
  if (n < 16) return COLORS_16[n]!;
  if (n < 232) {
    // 6×6×6 color cube (indices 16–231)
    const idx = n - 16;
    const r = Math.floor(idx / 36) * 51;
    const g = (Math.floor(idx / 6) % 6) * 51;
    const b = (idx % 6) * 51;
    return `rgb(${r},${g},${b})`;
  }
  // Grayscale ramp (indices 232–255)
  const level = (n - 232) * 10 + 8;
  return `rgb(${level},${level},${level})`;
}

function rgb(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
}

// ---------------------------------------------------------------------------
// Style state
// ---------------------------------------------------------------------------

interface StyleState {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

const DEFAULT_STYLE: Readonly<StyleState> = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strikethrough: false,
};

function spanFromStyle(text: string, s: StyleState): AnsiSpan {
  return {
    text,
    fg: s.fg,
    bg: s.bg,
    bold: s.bold,
    dim: s.dim,
    italic: s.italic,
    underline: s.underline,
    strikethrough: s.strikethrough,
  };
}

function spanMatchesStyle(span: AnsiSpan, s: StyleState): boolean {
  return (
    span.fg === s.fg &&
    span.bg === s.bg &&
    span.bold === s.bold &&
    span.dim === s.dim &&
    span.italic === s.italic &&
    span.underline === s.underline &&
    span.strikethrough === s.strikethrough
  );
}

// ---------------------------------------------------------------------------
// SGR param interpretation
// ---------------------------------------------------------------------------

/**
 * Parse an extended color (256 or 24-bit RGB) from the param array starting
 * after the `38`/`48` at position `i`.  Returns the resolved color string and
 * how many extra indices were consumed (so the caller can advance `i`).
 */
function parseExtendedColor(nums: number[], i: number): { color: string | null; skip: number } {
  if (nums[i + 1] === 5 && i + 2 < nums.length) {
    // 256-color: 38;5;n / 48;5;n
    return { color: color256(nums[i + 2]!), skip: 2 };
  }

  if (nums[i + 1] === 2) {
    // 24-bit RGB.  The library normalises standalone `38;2;R;G;B` to
    // `38;2;0;R;G;B` (inserting a color-space param), but does NOT normalise
    // combined sequences like `1;38;2;R;G;B;4`.  Heuristic: if the value
    // immediately after `2` is 0 and we have 4+ remaining values, treat it
    // as Cs;R;G;B (skip the color-space).  Otherwise treat as R;G;B.
    if (nums[i + 2] === 0 && i + 5 < nums.length) {
      return { color: rgb(nums[i + 3]!, nums[i + 4]!, nums[i + 5]!), skip: 5 };
    }
    if (i + 4 < nums.length) {
      return { color: rgb(nums[i + 2]!, nums[i + 3]!, nums[i + 4]!), skip: 4 };
    }
  }

  return { color: null, skip: 0 };
}

function applySgr(style: StyleState, params: string[]): void {
  // \x1b[m (empty params) is equivalent to reset
  if (params.length === 0) {
    Object.assign(style, DEFAULT_STYLE);
    return;
  }

  const nums = params.map(Number);
  let i = 0;
  while (i < nums.length) {
    const code = nums[i]!;

    // Reset
    if (code === 0) {
      Object.assign(style, DEFAULT_STYLE);
    }
    // Decorations on
    else if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 3) style.italic = true;
    else if (code === 4) style.underline = true;
    else if (code === 9) style.strikethrough = true;
    // Decorations off
    else if (code === 22) {
      style.bold = false;
      style.dim = false;
    } else if (code === 23) style.italic = false;
    else if (code === 24) style.underline = false;
    else if (code === 29) style.strikethrough = false;
    // Standard foreground (30–37)
    else if (code >= 30 && code <= 37) style.fg = COLORS_16[code - 30]!;
    // Extended foreground (38;5;n or 38;2;…)
    else if (code === 38) {
      const ext = parseExtendedColor(nums, i);
      style.fg = ext.color;
      i += ext.skip;
    }
    // Default foreground
    else if (code === 39) style.fg = null;
    // Standard background (40–47)
    else if (code >= 40 && code <= 47) style.bg = COLORS_16[code - 40]!;
    // Extended background (48;5;n or 48;2;…)
    else if (code === 48) {
      const ext = parseExtendedColor(nums, i);
      style.bg = ext.color;
      i += ext.skip;
    }
    // Default background
    else if (code === 49) style.bg = null;
    // Bright foreground (90–97)
    else if (code >= 90 && code <= 97) style.fg = COLORS_16[code - 90 + 8]!;
    // Bright background (100–107)
    else if (code >= 100 && code <= 107) style.bg = COLORS_16[code - 100 + 8]!;

    i++;
  }
}

// ---------------------------------------------------------------------------
// Trailing incomplete-escape detection
// ---------------------------------------------------------------------------

/**
 * Split `input` into a "complete" prefix that is safe to feed to the parser,
 * and a "remainder" suffix that contains a trailing incomplete escape sequence
 * (to be carried into the next chunk).
 */
function splitTrailingEscape(input: string): { complete: string; remainder: string } {
  const lastEsc = input.lastIndexOf("\x1b");
  if (lastEsc === -1) return { complete: input, remainder: "" };

  const tail = input.slice(lastEsc);

  // Complete CSI/SGR: \x1b[ <params> <letter>
  if (/^\x1b\[[\d;:]*[A-Za-z]/.test(tail)) return { complete: input, remainder: "" };
  // Complete two-char ESC sequence: \x1b <letter> (but not \x1b[ or \x1b])
  if (tail.length >= 2 && /^[A-Za-z]/.test(tail[1]!) && tail[1] !== "[" && tail[1] !== "]") {
    return { complete: input, remainder: "" };
  }
  // Complete OSC: \x1b] … terminated by BEL or ST
  if (/^\x1b\].*(?:\x07|\x1b\\)/s.test(tail)) return { complete: input, remainder: "" };

  // The tail is an incomplete escape — buffer it for the next chunk
  return { complete: input.slice(0, lastEsc), remainder: tail };
}

// ---------------------------------------------------------------------------
// Core: walk CODE[] from the library and emit AnsiSpan[]
// ---------------------------------------------------------------------------

function processCodeArray(codes: CODE[], style: StyleState): AnsiSpan[] {
  const spans: AnsiSpan[] = [];

  for (const code of codes) {
    if (code.type === "TEXT") {
      if (code.raw.length === 0) continue;

      // Coalesce with previous span when styles match
      const prev = spans.at(-1);
      if (prev && spanMatchesStyle(prev, style)) {
        prev.text += code.raw;
      } else {
        spans.push(spanFromStyle(code.raw, style));
      }
    } else if (code.type === "CSI" && code.command === "m") {
      applySgr(style, code.params);
    }
    // All other control codes (CSI non-SGR, OSC, DCS, …) are silently dropped
  }

  return spans;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Stateless single-shot ANSI parse (no cross-chunk state). */
export function parseAnsi(input: string): AnsiSpan[] {
  if (!input) return [];
  if (!input.includes("\x1b")) return [spanFromStyle(input, DEFAULT_STYLE)];

  const codes = parse(input);
  const style: StyleState = { ...DEFAULT_STYLE };
  return processCodeArray(codes, style);
}

/**
 * Create a stateful ANSI processor that carries SGR style and
 * incomplete-escape buffers across successive `feed()` calls.
 */
export function createAnsiProcessor(): AnsiProcessor {
  let pending = "";
  const style: StyleState = { ...DEFAULT_STYLE };

  return {
    feed(chunk: string): AnsiSpan[] {
      const input = pending + chunk;
      pending = "";

      const { complete, remainder } = splitTrailingEscape(input);
      pending = remainder;

      if (!complete) return [];
      if (!complete.includes("\x1b")) return [spanFromStyle(complete, style)];

      const codes = parse(complete);
      return processCodeArray(codes, style);
    },
  };
}
