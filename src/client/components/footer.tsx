import { Heart } from "lucide-react";

export const Footer = () => (
  <footer className="mt-12 border-t border-zinc-800/60 py-6 text-center text-xs text-zinc-500">
    <p className="flex items-center justify-center gap-1">
      Made with <Heart className="inline h-3 w-3 text-accent-500" /> on Cloudflare
    </p>
    <a
      href="https://git-on-cloudflare.com/rachel/anvil"
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 inline-block text-zinc-500 underline decoration-zinc-700 underline-offset-2 transition-colors hover:text-accent-400"
    >
      Source code
    </a>
    <p className="mt-2">
      Part of{" "}
      <a
        href="https://devbin.tools"
        className="text-zinc-500 underline decoration-zinc-700 underline-offset-2 transition-colors hover:text-accent-400"
      >
        devbin.tools
      </a>
    </p>
  </footer>
);
