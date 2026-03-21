import type { AuthMode } from "@/client/lib";

interface ModeToggleProps {
  currentMode: AuthMode;
  onChange(mode: AuthMode): void;
}

const buttonClass = (active: boolean): string =>
  [
    "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
    active ? "bg-accent-500/15 text-accent-300" : "text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200",
  ].join(" ");

export const ModeToggle = ({ currentMode, onChange }: ModeToggleProps) => (
  <div className="inline-flex rounded-lg border border-zinc-800/70 bg-zinc-900/80 p-0.5">
    <button
      type="button"
      aria-pressed={currentMode === "mock"}
      className={buttonClass(currentMode === "mock")}
      onClick={() => onChange("mock")}
    >
      Mock
    </button>
    <button
      type="button"
      aria-pressed={currentMode === "live"}
      className={buttonClass(currentMode === "live")}
      onClick={() => onChange("live")}
    >
      Live
    </button>
  </div>
);
