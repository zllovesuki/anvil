import { describe, expect, it } from "vitest";

import { createAnsiProcessor, parseAnsi, type AnsiSpan } from "@/client/lib";

/** Helper: extract just the fields we care about from a span. */
const pick = (span: AnsiSpan, ...keys: (keyof AnsiSpan)[]) => Object.fromEntries(keys.map((k) => [k, span[k]]));

// ---------------------------------------------------------------------------
// parseAnsi (stateless, single-shot)
// ---------------------------------------------------------------------------

describe("parseAnsi", () => {
  it("returns empty array for empty input", () => {
    expect(parseAnsi("")).toEqual([]);
  });

  it("passes plain text through as a single unstyled span", () => {
    const spans = parseAnsi("hello world");
    expect(spans).toHaveLength(1);
    expect(spans[0]!.text).toBe("hello world");
    expect(spans[0]!.fg).toBeNull();
    expect(spans[0]!.bold).toBe(false);
  });

  // -- Standard foreground colors ------------------------------------------

  it("parses standard foreground colors (30–37)", () => {
    const spans = parseAnsi("\x1b[31mred text\x1b[0m plain");
    expect(spans).toHaveLength(2);
    expect(pick(spans[0]!, "text", "fg")).toEqual({ text: "red text", fg: "#f87171" });
    expect(spans[1]!.fg).toBeNull(); // after reset
  });

  it("parses bright foreground colors (90–97)", () => {
    const spans = parseAnsi("\x1b[92mbright green\x1b[0m");
    expect(spans[0]!.fg).toBe("#86efac");
  });

  // -- Background colors ---------------------------------------------------

  it("parses standard background colors (40–47)", () => {
    const spans = parseAnsi("\x1b[44mblue bg\x1b[0m");
    expect(spans[0]!.bg).toBe("#60a5fa");
  });

  it("parses bright background colors (100–107)", () => {
    const spans = parseAnsi("\x1b[103mbright yellow bg\x1b[0m");
    expect(spans[0]!.bg).toBe("#fde047");
  });

  // -- 256-color -----------------------------------------------------------

  it("parses 256-color foreground (38;5;n) — standard palette", () => {
    const spans = parseAnsi("\x1b[38;5;1mred\x1b[0m");
    expect(spans[0]!.fg).toBe("#f87171");
  });

  it("parses 256-color foreground — color cube", () => {
    // Index 196 = r=5,g=0,b=0 → rgb(255,0,0)
    const spans = parseAnsi("\x1b[38;5;196mred cube\x1b[0m");
    expect(spans[0]!.fg).toBe("rgb(255,0,0)");
  });

  it("parses 256-color foreground — grayscale ramp", () => {
    // Index 240 = (240-232)*10+8 = 88
    const spans = parseAnsi("\x1b[38;5;240mgray\x1b[0m");
    expect(spans[0]!.fg).toBe("rgb(88,88,88)");
  });

  it("parses 256-color background (48;5;n)", () => {
    const spans = parseAnsi("\x1b[48;5;21mblue bg\x1b[0m");
    expect(spans[0]!.bg).toMatch(/^rgb\(/);
  });

  // -- 24-bit RGB ----------------------------------------------------------

  it("parses 24-bit foreground (38;2;r;g;b)", () => {
    const spans = parseAnsi("\x1b[38;2;128;64;255mpurple\x1b[0m");
    expect(spans[0]!.fg).toBe("rgb(128,64,255)");
  });

  it("parses 24-bit background (48;2;r;g;b)", () => {
    const spans = parseAnsi("\x1b[48;2;10;20;30mdark bg\x1b[0m");
    expect(spans[0]!.bg).toBe("rgb(10,20,30)");
  });

  // -- Decorations ---------------------------------------------------------

  it("parses bold", () => {
    const spans = parseAnsi("\x1b[1mbold\x1b[0m plain");
    expect(spans[0]!.bold).toBe(true);
    expect(spans[1]!.bold).toBe(false);
  });

  it("parses dim", () => {
    const spans = parseAnsi("\x1b[2mdim\x1b[0m");
    expect(spans[0]!.dim).toBe(true);
  });

  it("parses italic", () => {
    const spans = parseAnsi("\x1b[3mitalic\x1b[0m");
    expect(spans[0]!.italic).toBe(true);
  });

  it("parses underline", () => {
    const spans = parseAnsi("\x1b[4munderline\x1b[0m");
    expect(spans[0]!.underline).toBe(true);
  });

  it("parses strikethrough", () => {
    const spans = parseAnsi("\x1b[9mstrike\x1b[0m");
    expect(spans[0]!.strikethrough).toBe(true);
  });

  // -- Resets --------------------------------------------------------------

  it("resets all styles with code 0", () => {
    const spans = parseAnsi("\x1b[1;31;4mbold red underline\x1b[0mplain");
    expect(spans[0]!.bold).toBe(true);
    expect(spans[0]!.fg).toBe("#f87171");
    expect(spans[0]!.underline).toBe(true);

    expect(spans[1]!.bold).toBe(false);
    expect(spans[1]!.fg).toBeNull();
    expect(spans[1]!.underline).toBe(false);
  });

  it("treats \\x1b[m as a full reset", () => {
    const spans = parseAnsi("\x1b[1mBold\x1b[mNormal");
    expect(spans[1]!.bold).toBe(false);
  });

  it("partially resets bold/dim with code 22", () => {
    const spans = parseAnsi("\x1b[1;3mbold italic\x1b[22mnot bold\x1b[0m");
    expect(spans[0]!.bold).toBe(true);
    expect(spans[0]!.italic).toBe(true);
    expect(spans[1]!.bold).toBe(false);
    expect(spans[1]!.italic).toBe(true); // italic NOT cleared by 22
  });

  it("resets foreground with code 39", () => {
    const spans = parseAnsi("\x1b[31mred\x1b[39mdefault");
    expect(spans[0]!.fg).toBe("#f87171");
    expect(spans[1]!.fg).toBeNull();
  });

  it("resets background with code 49", () => {
    const spans = parseAnsi("\x1b[42mgreen bg\x1b[49mno bg");
    expect(spans[0]!.bg).toBe("#4ade80");
    expect(spans[1]!.bg).toBeNull();
  });

  // -- Combined codes ------------------------------------------------------

  it("parses combined SGR codes in a single sequence", () => {
    const spans = parseAnsi("\x1b[1;31mbold red\x1b[0m");
    expect(spans[0]!.bold).toBe(true);
    expect(spans[0]!.fg).toBe("#f87171");
  });

  // -- Non-SGR stripping ---------------------------------------------------

  it("strips cursor movement sequences", () => {
    const spans = parseAnsi("before\x1b[2Jafter");
    const text = spans.map((s) => s.text).join("");
    expect(text).toBe("beforeafter");
  });

  it("strips OSC sequences", () => {
    const spans = parseAnsi("before\x1b]0;window title\x07after");
    const text = spans.map((s) => s.text).join("");
    expect(text).toBe("beforeafter");
  });

  // -- Coalescing ----------------------------------------------------------

  it("coalesces adjacent text with the same style", () => {
    // Two TEXT nodes with no style change between them
    const spans = parseAnsi("hello world");
    expect(spans).toHaveLength(1);
  });

  it("does not emit empty spans for consecutive SGR codes", () => {
    const spans = parseAnsi("\x1b[1m\x1b[31mred bold\x1b[0m");
    // Should not have any empty-text spans
    for (const span of spans) {
      expect(span.text.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// createAnsiProcessor (stateful, cross-chunk)
// ---------------------------------------------------------------------------

describe("createAnsiProcessor", () => {
  it("carries style state across chunks", () => {
    const proc = createAnsiProcessor();
    const s1 = proc.feed("\x1b[31m");
    // Setting a color without text may produce no spans
    expect(s1).toHaveLength(0);

    const s2 = proc.feed("Hello");
    expect(s2).toHaveLength(1);
    expect(s2[0]!.fg).toBe("#f87171");
    expect(s2[0]!.text).toBe("Hello");
  });

  it("handles split escape sequences across chunks", () => {
    const proc = createAnsiProcessor();

    // First chunk ends mid-escape
    const s1 = proc.feed("Hello\x1b[3");
    expect(s1).toHaveLength(1);
    expect(s1[0]!.text).toBe("Hello");
    expect(s1[0]!.fg).toBeNull();

    // Second chunk completes the escape
    const s2 = proc.feed("1mWorld");
    expect(s2).toHaveLength(1);
    expect(s2[0]!.text).toBe("World");
    expect(s2[0]!.fg).toBe("#f87171");
  });

  it("handles escape split at just the ESC byte", () => {
    const proc = createAnsiProcessor();
    const s1 = proc.feed("Text\x1b");
    expect(s1).toHaveLength(1);
    expect(s1[0]!.text).toBe("Text");

    const s2 = proc.feed("[32mGreen");
    expect(s2).toHaveLength(1);
    expect(s2[0]!.fg).toBe("#4ade80");
    expect(s2[0]!.text).toBe("Green");
  });

  it("resets style across chunks", () => {
    const proc = createAnsiProcessor();
    proc.feed("\x1b[1;31m");
    const s1 = proc.feed("Red bold");
    expect(s1[0]!.fg).toBe("#f87171");
    expect(s1[0]!.bold).toBe(true);

    const s2 = proc.feed("\x1b[0mPlain");
    expect(s2).toHaveLength(1);
    expect(s2[0]!.fg).toBeNull();
    expect(s2[0]!.bold).toBe(false);
    expect(s2[0]!.text).toBe("Plain");
  });

  it("processes multiple chunks in sequence", () => {
    const proc = createAnsiProcessor();

    proc.feed("\x1b[32m");
    const s1 = proc.feed("step 1\n");
    expect(s1[0]!.fg).toBe("#4ade80");

    proc.feed("\x1b[33m");
    const s2 = proc.feed("step 2\n");
    expect(s2[0]!.fg).toBe("#facc15");

    proc.feed("\x1b[0m");
    const s3 = proc.feed("done\n");
    expect(s3[0]!.fg).toBeNull();
  });

  it("handles plain text chunks without escape codes", () => {
    const proc = createAnsiProcessor();
    const s1 = proc.feed("just text");
    expect(s1).toHaveLength(1);
    expect(s1[0]!.text).toBe("just text");
    expect(s1[0]!.fg).toBeNull();
  });

  it("handles empty chunk", () => {
    const proc = createAnsiProcessor();
    const s = proc.feed("");
    expect(s).toHaveLength(0);
  });
});
