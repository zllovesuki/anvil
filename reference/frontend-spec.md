# Frontend Specification

Canonical standard for: **anvil**, **flamemail**, **git-on-cloudflare**

This document defines the shared frontend conventions that all projects **must** follow.
Per-project deviations are called out explicitly; everything else is universal.

---

## 1. Core Stack

| Layer         | Choice                   | Version                       |
| ------------- | ------------------------ | ----------------------------- |
| UI Framework  | React                    | `^19.x`                       |
| Build Tool    | Vite                     | `^7.x`                        |
| CSS Framework | Tailwind CSS             | `v4.x` (CSS-native config)    |
| Icons         | lucide-react             | `^0.542+`                     |
| Language      | TypeScript (strict mode) | `^5.9+`                       |
| Deploy Target | Cloudflare Workers       | via `@cloudflare/vite-plugin` |

### Vite Plugins (always present)

1. `@tailwindcss/vite` -- Tailwind CSS v4 native integration (**no** PostCSS config)
2. `@vitejs/plugin-react` -- React JSX transform + Fast Refresh
3. `@cloudflare/vite-plugin` -- Cloudflare Workers build + dev

### Path Alias

All projects use `@` as a path alias to the source root:

```ts
// vite.config.ts
resolve: {
  alias: {
    "@": resolve(__dirname, "src"),
  },
}

// tsconfig.json
"paths": { "@/*": ["src/*"] }
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  }
}
```

- Bundler module resolution (Vite-compatible)
- `react-jsx` automatic runtime (no `import React` needed)
- `noEmit` -- Vite handles transpilation; TypeScript is type-checking only

---

## 2. Directory Layout

### Canonical Structure (SPA projects)

```
src/
  client/
    main.tsx                  # React entry: createRoot
    app.tsx                   # Route definitions only (react-router-dom Routes)
    components/
      app-shell.tsx           # Header + <Outlet /> + Footer + ToastContainer
      header.tsx              # Standalone Header component
      footer.tsx              # Standalone Footer component
      toast.tsx               # Toast system (module-level singleton + ToastContainer)
      ui/                     # Reusable design-system primitives
        button.tsx
        card.tsx
        input.tsx
        badge.tsx
        dialog.tsx
        empty-state.tsx
        error-banner.tsx
        page-header.tsx
        index.ts              # Barrel export
      index.ts                # Barrel export for all components
    hooks/                    # Custom React hooks
    lib/                      # API clients, utilities
    pages/                    # One file per route/page
    styles/
      app.css                 # Global CSS (single file)
  shared/                     # Shared types/contracts (client + worker)
    contracts/
  worker/                     # Cloudflare Worker backend code
```

### SSR + Islands Extension (git-on-cloudflare)

SSR projects keep the same top-level `client/` directory but add SSR-specific sub-directories:

```
src/
  client/
    components/               # Same as SPA (header.tsx, footer.tsx, ui/, etc.)
    pages/                    # Page components (receive props from registry)
    islands/                  # Interactive widgets hydrated on the client
    server/                   # SSR pipeline (runs on the Worker)
      render.tsx              # renderToReadableStream entry
      document.tsx            # <html> shell (replaces index.html)
      registry.tsx            # View name -> page component + entrypoints map
      island-host.tsx         # Serializes island props for client hydration
    entries/                  # Per-page client entry bundles
    hydrate.tsx               # Generic island hydration helper
    styles/
      app.css
  shared/
  worker/
```

**Key rule**: There is no `ui/` directory at the `src/` root level. Client-side code always lives under `src/client/`.

### Naming Conventions

- **File names**: `kebab-case.tsx` (e.g., `app-shell.tsx`, `page-header.tsx`)
- **Component exports**: `PascalCase` (e.g., `AppShell`, `PageHeader`)
- **Hook files**: `use-<name>.ts` (e.g., `use-inbox.ts`, `use-polling.ts`)
- **Barrel exports**: `index.ts` in `components/`, `components/ui/`, `hooks/`, `pages/`

---

## 3. Styling & Aesthetics

### Devbin Tools Design Philosophy

**"Consistently Distinctive"**: Every app within the `devbin.tools` ecosystem shares a consistent technical foundation and base visual language (dark-mode Zinc palette, standard shell components, specific shadows/radii) so users visually recognize they are using a `devbin.tools` product. 

However, within these shared constraints, each application must exhibit a **distinctive, bold, and memorable aesthetic**.
- **Aesthetic Direction**: Interpret the project's specific purpose creatively. Pick an aesthetic flavor that fits the tool's tone (e.g., brutalist/utilitarian, premium/refined, retro-terminal, etc.) and inject that flavor via typography, backgrounds, or layouts.
- **No Generic Predictability**: Avoid uninspired aesthetics like cliched layouts, overly predictable component patterns, and standard minimalist boilerplate. Design should be deeply intentional.
- **Visual Depth**: Create atmosphere and depth. Rather than sticking purely to flat Zinc surfaces, selectively apply contextual effects (gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, or custom cursors) that define the app's unique identity.

### Approach

- **Tailwind CSS v4** with CSS-native `@theme` configuration
- **No** `tailwind.config.js`, `tailwind.config.ts`, or `postcss.config.*` files
- **No** CSS-in-JS, CSS Modules, or Styled Components
- **No** `@utility` rules -- all styling via Tailwind utility classes inline in JSX or via React component variants
- One global CSS file at `client/styles/app.css`

### Shadows

Keep drop shadows subtle. Prefer `shadow-sm` over `shadow-lg`/`shadow-xl`.

| Element           | Static shadow                    | Hover shadow                                 |
| ----------------- | -------------------------------- | -------------------------------------------- |
| Logo / brand icon | `shadow-sm shadow-accent-500/10` | --                                           |
| Primary button    | `shadow-sm shadow-accent-500/10` | `hover:shadow-md hover:shadow-accent-500/15` |
| Card hover        | --                               | `hover:shadow-sm`                            |

Never use `shadow-lg` or `shadow-xl` on interactive elements. Reserve `shadow-2xl` for modals/dialogs only.

### Card & Selection Hover

**Never animate border hue shifts** (e.g., zinc → accent or zinc → amber via `transition-colors`). The color morph through intermediate tones looks unnatural even at 75ms. Instead:

- **Cards / list rows**: instant hover (no `transition-*`), lighten the border within the same hue: `hover:border-zinc-700/60 hover:bg-zinc-900/80`.
- **Toggle / selection buttons** (e.g., TTL picker, radio-style options): no transition on the border. Let the selected/unselected state swap instantly via conditional classes.
- **Small action buttons**: same rule -- `hover:border-zinc-600` (zinc lightening), no hue shift.
- **Reserve `transition-colors`** for elements that only change background or text within the same hue family (e.g., `hover:bg-zinc-700/60`), or for nav links and standalone text links.

### Transitions

**Never use `transition-all`** -- it transitions every CSS property (including layout-triggering ones) and causes jank even when nothing changes. Always scope to the properties that actually change:

| What changes                    | Transition class                                 |
| ------------------------------- | ------------------------------------------------ |
| Color, background, border-color | `transition-colors`                              |
| Box shadow + border             | `transition-[border-color,box-shadow]`           |
| Box shadow + color + background | `transition-[color,background-color,box-shadow]` |
| Filter (brightness) + opacity   | `transition-[filter,opacity]`                    |
| Opacity only                    | `transition-opacity`                             |
| Transform (scale, translate)    | `transition-transform`                           |

Default transition duration is overridden to **75ms** via `--default-transition-duration` in `@theme` (Tailwind default is 150ms, which feels sluggish on hover). Do not use `hover:brightness-*` on gradient buttons -- it forces the GPU to recompute the filtered gradient each frame. Use a color swap instead (e.g., `hover:from-accent-400 hover:to-accent-500`).

### Performance

- **Ambient glow & Textures**: apply the radial-gradient glow directly on `body`'s `background-image` alongside `background-color`. **Do not** use a `position: fixed` pseudo-element (`body::before`) — even with `will-change: transform`, a full-viewport fixed layer forces compositor blending against all scrolling content every frame, halving scroll frame rate (~33ms p50 vs ~16.7ms). Putting the gradient on `body` itself avoids the extra compositing layer entirely with no visual difference (the glow is ≤ 2% opacity). Adding grain, noise textures, or geometric grid patterns on top of this glow is highly encouraged to give the app a tactile feel, as long as it is applied performantly via CSS `background-image` layering on the `body`.
- **`backdrop-blur-sm`** on sticky headers is acceptable. Prefer `backdrop-blur-sm` (4px) over `backdrop-blur-xl` (24px) — the larger radius is ~6× more expensive per frame and barely distinguishable at high background opacity. Pair with `bg-zinc-950/95` so the blur is cosmetic, not structural.

### Global CSS Template

Every project's `app.css` follows this exact structure. The **only** per-project differences are the `--color-accent-*` values and the ambient glow RGB values on `body`.

```css
@import "tailwindcss";

/* Dynamic class safelist (add @source inline(...) entries as needed) */

@theme {
  --default-transition-duration: 75ms;

  --font-sans: "Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", "Fira Code", monospace;

  /* Project accent color palette -- replace values per project */
  --color-accent-50: ...;
  --color-accent-100: ...;
  --color-accent-200: ...;
  --color-accent-300: ...;
  --color-accent-400: ...;
  --color-accent-500: ...;
  --color-accent-600: ...;
  --color-accent-700: ...;
  --color-accent-800: ...;
  --color-accent-900: ...;

  --animate-fade-in: fade-in 0.4s ease-out both;
  --animate-slide-up: slide-up 0.35s ease-out both;
  --animate-scale-fade: scale-fade 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
  --animate-shimmer: shimmer 1.5s ease-in-out infinite;
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes slide-up {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes scale-fade {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes shimmer {
  from {
    background-position: -200% 0;
  }
  to {
    background-position: 200% 0;
  }
}

html {
  color-scheme: dark;
}
html,
body {
  min-height: 100vh;
}

body {
  @apply text-zinc-100 antialiased;
  background-color: #09090b;
  background-image:
    radial-gradient(circle, rgba(255,255,255,0.03) 0.5px, transparent 0.5px),
    radial-gradient(circle, rgba(255,255,255,0.02) 0.5px, transparent 0.5px),
    radial-gradient(circle at 20% 20%, rgba(<accent-rgb>, 0.02), transparent 50%),
    radial-gradient(circle at 80% 80%, rgba(<accent-rgb>, 0.015), transparent 50%);
  background-size: 3px 3px, 7px 7px, 100% 100%, 100% 100%;
}

#root {
  min-height: 100vh;
}

button:not(:disabled),
select,
summary,
[role="button"] {
  cursor: pointer;
}

::selection {
  background: rgba(<accent-rgb>, 0.28);
  color: var(--color-accent-50);
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
```

---

## 4. Color System

### Dark Mode

All projects are **dark-mode primary** (or dark-only). The `<html>` element carries `class="dark"` and `color-scheme: dark` is set on the root.

If light mode is supported, it uses the class-based toggle pattern (`html.dark` / `html` without `.dark`) with the user's preference stored in `localStorage` under key `"theme"`, defaulting to `"dark"`. A bootstrap script in `<head>` reads this value and applies the class before first paint to prevent flash.

### Neutral Palette: Zinc

Every project uses Tailwind's `zinc` scale as the neutral foundation:

| Token      | Hex       | Usage                                                    |
| ---------- | --------- | -------------------------------------------------------- |
| `zinc-950` | `#09090b` | Body/page background                                     |
| `zinc-900` | `#18181b` | Card/section backgrounds, input backgrounds              |
| `zinc-800` | `#27272a` | Borders, secondary backgrounds (often at `/60` or `/80`) |
| `zinc-700` | `#3f3f46` | Control borders, dividers                                |
| `zinc-600` | `#52525b` | Muted icons, disabled states                             |
| `zinc-500` | `#71717a` | Muted/placeholder text                                   |
| `zinc-400` | `#a1a1aa` | Secondary text                                           |
| `zinc-300` | `#d4d4d8` | Near-white text, secondary headings                      |
| `zinc-200` | `#e4e4e7` | Headings, prominent text                                 |
| `zinc-100` | `#f4f4f5` | Primary body text                                        |

### Accent Color Palette

Every project defines its accent as `accent-*` via `@theme`. **Never** use project-specific names (e.g., ~~`flame-*`~~) or raw Tailwind color names (e.g., ~~`indigo-*`~~) for the accent. This ensures that shell components, buttons, nav links, and all accent-referencing classes are identical across projects.

| Project           | Accent-500 (primary) | Hue Family | RGB for glow   |
| ----------------- | -------------------- | ---------- | -------------- |
| anvil             | `#3b82f6`            | Blue       | `59, 130, 246` |
| flamemail         | `#f97316`            | Orange     | `249, 115, 22` |
| git-on-cloudflare | `#6366f1`            | Indigo     | `99, 102, 241` |

The accent palette follows a 50--900 scale identical in structure to Tailwind's built-in color scales.

### Accent Color Application Pattern

| Element                 | Classes                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Primary CTA button      | `bg-gradient-to-r from-accent-500 to-accent-600 text-white shadow-sm shadow-accent-500/10` |
| Secondary button        | `border border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700/60`              |
| Active nav item         | `bg-accent-500/10 text-accent-400`                                                         |
| Inputs (focus)          | `focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/30`                         |
| Logo icon background    | `bg-gradient-to-br from-accent-500 to-accent-600`                                          |
| Unread/active indicator | `bg-accent-500`                                                                            |
| Ambient background glow | `rgba(<accent-rgb>, 0.02)` radial gradients                                                |

### Semantic Colors

| State   | Background          | Text               | Border                  |
| ------- | ------------------- | ------------------ | ----------------------- |
| Success | `bg-emerald-500/10` | `text-emerald-400` | `border-emerald-500/20` |
| Error   | `bg-red-500/10`     | `text-red-400`     | `border-red-500/20`     |
| Warning | `bg-amber-500/10`   | `text-amber-300`   | `border-amber-500/20`   |
| Info    | `bg-accent-500/10`  | `text-accent-400`  | `border-accent-500/20`  |

---

## 5. Typography

### Primary Fonts

The Devbin ecosystem uses `Hanken Grotesk` and `JetBrains Mono` as the shared baseline for body text, inputs, and UI components. **Generic fonts like Arial, Roboto, or Inter are strictly forbidden.**

However, to give each app its distinctive aesthetic, **you are heavily encouraged to pair a bold, characterful Display font** for primary headings (`<h1>`, `<h2>`, hero text) alongside the refined `Hanken Grotesk` body font. Consider unconventional choices that elevate the visual interest (e.g., striking serifs, geometric displays, or brutalist grotesques).

Loaded via Google Fonts `<link>` tags with `preconnect`:

| Font                    | Weights                 | Usage                                      |
| ----------------------- | ----------------------- | ------------------------------------------ |
| **Hanken Grotesk**      | 400, 500, 600, 700      | Body, UI elements, secondary headings      |
| **JetBrains Mono**      | 400, 500                | Code blocks, monospace content             |
| **[Project Display]**   | *as needed*             | High-impact headings (Display, H1, Heroes) |

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<!-- Always include the baseline fonts, plus any distinctive display fonts chosen for the specific project -->
<link
  href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Project+Specific+Display&display=swap"
  rel="stylesheet"
/>
```

### Font Stacks (defined in `@theme`)

```css
--font-sans: "Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, sans-serif;
--font-mono: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
```

### Heading Scale

Headings use tighter tracking and heavier weights for visual hierarchy:

| Level   | Classes                                                       | Usage                       |
| ------- | ------------------------------------------------------------- | --------------------------- |
| Display | `text-3xl sm:text-4xl font-extrabold tracking-tight`          | Hero headlines, page titles |
| H1      | `text-2xl font-bold tracking-tight`                           | Section titles              |
| H2      | `text-xl font-semibold`                                       | Card titles, subsections    |
| H3      | `text-base font-semibold`                                     | List labels, sidebar heads  |
| Caption | `text-xs font-medium uppercase tracking-widest text-zinc-500` | Overlines, meta labels      |

- `tracking-tight` (`-0.025em`) on Display and H1 tightens letterforms for impact at large sizes
- `tracking-widest` (`0.1em`) on Captions creates a small-caps effect for overlines and meta labels
- Never use `font-light` or `font-thin` — insufficient contrast on dark backgrounds

---

## 6. Animations & Motion

### Philosophy

Motion should feel intentional, physical, and **high-impact**. Prefer orchestrated sequences (such as a single, well-choreographed page load with staggered reveals) over scattered, distracting micro-animations. Every animation must serve either **orientation** (where am I?), **feedback** (what did I do?), or **continuity** (what just changed?). 

To create genuine delight, deeply integrate motion into the aesthetic: use scroll-triggering, surprise hover states, and smooth staggered cascades that breathe life into the UI.

### Standard Keyframes

Four keyframes are defined in every project's `app.css`:

| Name         | Duration | Easing                        | Effect                                          |
| ------------ | -------- | ----------------------------- | ----------------------------------------------- |
| `fade-in`    | 0.4s     | ease-out                      | Opacity 0 → 1                                   |
| `slide-up`   | 0.35s    | ease-out                      | Opacity 0 + translateY(12px) → visible          |
| `scale-fade` | 0.3s     | cubic-bezier(0.16, 1, 0.3, 1) | Opacity 0 + scale(0.96) → visible               |
| `shimmer`    | 1.5s     | ease-in-out                   | Background position sweep (loading placeholder) |

### Entrance Animations

- `animate-fade-in` — main content areas on page load
- `animate-slide-up` — page-level content wrappers, modal/dialog entrances
- `animate-scale-fade` — cards, popovers, dropdown menus (scale implies origin)

### Staggered Reveals

When multiple sibling elements enter together (card grids, list items, stat blocks), stagger their `animation-delay` to create a cascade:

```tsx
{
  items.map((item, i) => (
    <Card key={item.id} className="animate-slide-up opacity-0" style={{ animationDelay: `${i * 60}ms` }} />
  ));
}
```

Rules:

- Base delay increment: **60ms** per item (fast enough to feel connected, slow enough to perceive the sequence)
- Cap at **8 items** (480ms total) — beyond that, truncate the stagger so the tail doesn't drag
- Always set `opacity-0` on the element so it's invisible before the animation fires (`animation-fill-mode: both` in the keyframe handles the final state)

### Interaction Micro-Animations

| Interaction         | Effect                       | Implementation                                    |
| ------------------- | ---------------------------- | ------------------------------------------------- |
| Button press        | Subtle scale-down on active  | `active:scale-[0.98]` + `transition-transform`    |
| Card hover lift     | Slight upward shift          | `hover:-translate-y-0.5` + `transition-transform` |
| Icon button hover   | Gentle scale                 | `hover:scale-105` + `transition-transform`        |
| Toggle state change | Instant swap (no transition) | Conditional classes, no `transition-*`            |
| Toast entrance      | Slide up from bottom-right   | `animate-slide-up`                                |
| Dropdown open       | Scale from origin + fade     | `animate-scale-fade` with `transform-origin`      |

### Loading Skeletons

Use a shimmer animation for placeholder content:

```
Skeleton: bg-gradient-to-r from-zinc-800/0 via-zinc-700/40 to-zinc-800/0 bg-[length:200%_100%] animate-shimmer rounded-lg
```

### What Not to Animate

- **Layout properties**: `width`, `height`, `top`, `left`, `margin`, `padding` — triggers layout recalculation
- **Border hue shifts**: covered in Section 3 (no zinc → accent transitions)
- **Scroll-linked parallax**: avoid JS-driven scroll animations — they fight the compositor and add jank
- **Below-fold entrances**: only animate elements visible on initial load; below-fold content should already be in its final state when scrolled into view

---

## 7. Page Layout

### HTML Shell (SPA)

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{project name}</title>
    <!-- Google Fonts -->
  </head>
  <body class="bg-zinc-950 text-zinc-100">
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

SSR projects generate the `<html>` document in `server/document.tsx` instead of a static `index.html`.

### App Shell Component (`app-shell.tsx`)

Every project has an `app-shell.tsx` that renders:

```tsx
<div className="relative z-10 min-h-screen">
  <Header />
  <main>
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="animate-slide-up">{/* SPA: <Outlet /> | SSR: {children} */}</div>
    </div>
  </main>
  <Footer />
  <ToastContainer />
</div>
```

- **SPA projects** use `<Outlet />` from `react-router-dom` for nested routes.
- **SSR projects** accept `{children}` as a prop.
- The `<Header />` and `<Footer />` are **always** standalone files, never inlined.

### Header (`header.tsx`)

- **Position**: `sticky top-0 z-50`
- **Background**: `bg-zinc-950/95 backdrop-blur-sm` (dark), `bg-white/95 backdrop-blur-sm` (light)
- **Border**: `border-b border-zinc-800/60`
- **Container**: `max-w-7xl mx-auto px-4 sm:px-6`
- **Logo**: gradient icon (`rounded-lg bg-gradient-to-br from-accent-500 to-accent-600 shadow-sm shadow-accent-500/10`) + app name + subtitle
- **Nav links**: Icon + label, `bg-accent-500/10 text-accent-400` when active

### Footer (`footer.tsx`)

- **Spacing**: `mt-12 border-t border-zinc-800/60`
- **Content**: "Made with [heart] on Cloudflare", source code link, "Part of devbin.tools"
- **Text**: `text-xs text-zinc-500`
- **Heart**: `text-accent-500`
- **Links**: `underline decoration-zinc-700 underline-offset-2 hover:text-accent-400`

### Content Container

- **Max width**: `max-w-7xl` (1280px)
- **Padding**: `px-4 sm:px-6` (horizontal), `py-6` (vertical)
- **Centered**: `mx-auto`

### Hero, Layout & Spatial Composition

**Banish Generic Patterns.** The default "three feature cards in a row" or the generic centered-hero-with-two-buttons are the hallmark of lazy AI-generated pages. Layouts should use highly creative, purpose-built compositions that align with the app's chosen aesthetic:

- **Unexpected Layouts**: Don't default to perfectly symmetric constraints. Embrace asymmetry, grid-breaking overlapping elements, diagonal flows, and either generous negative space or tightly controlled density depending on the tone.
- **Show the product**: Use live demos, interactive previews, terminal recordings, or stylized component showcases—not abstract descriptions floating in a rounded rectangle.
- **Typographic Impact**: A dominant, oversized Display heading featuring the project's unique font paired with strong negative space is vastly superior to scattered bullet points.
- **Alternative Rhythms**: If you need to list features or data, use a simple `dl`, a two-column prose layout with inline `text-accent-400` highlights, dramatic large-numbered lists, or staggered asymmetric masonry—do **not** wrap every item in a bordered card.
- **Reserve `<Card>` primitives for actual content**: Cards are for user-facing data objects (emails, repos, pastes)—not for decorating marketing copy or simple instructions.

When a page _does_ need a multi-item grid (e.g., a dashboard), each card should contain real, scannable data—not just an icon, a title, and a placeholder sentence.

---

## 8. Component Patterns

### Reusable UI Primitives (`components/ui/`)

Every project must have a `components/ui/` directory with at least these components. They use `accent-*` tokens so they work identically across projects.

#### Button

Variants: `primary`, `secondary`, `danger`, `ghost`. Sizes: `sm`, `md`.

```
Primary:   bg-gradient-to-r from-accent-500 to-accent-600 text-white shadow-sm shadow-accent-500/10 active:scale-[0.98] transition-transform
Secondary: border border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700/60 active:scale-[0.98] transition-transform
Danger:    border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 active:scale-[0.98] transition-transform
Ghost:     text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100 active:scale-[0.97] transition-transform
```

#### Card

Variants: `default`, `accent`.

```
Default: rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 sm:p-6
Accent:  rounded-2xl border border-accent-500/20 bg-gradient-to-br from-zinc-900/80 to-zinc-900/40 p-5 sm:p-6
```

Interactive (clickable) cards add: `hover:-translate-y-0.5 transition-transform cursor-pointer`

#### Input

```
w-full rounded-xl border border-zinc-700/60 bg-zinc-800/80 px-4 py-2.5
text-zinc-100 placeholder:text-zinc-500
focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/30 focus:outline-none
focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950
```

With label, helper text, and error states.

### Toast Notifications

- **Position**: `fixed bottom-4 right-4 z-[100]`
- **Animation**: `animate-slide-up`
- **Auto-dismiss**: 4 seconds
- **Styles**: success (emerald), error (red), info (accent)
- **API**: Module-level singleton pattern (`toast.success(msg)`, `toast.error(msg)`, `toast.info(msg)`) or context-based `useToast()` -- either approach is fine, but each project picks one.

### Two-Column Grid (responsive)

```
grid gap-5 lg:grid-cols-[minmax(230px,400px)_minmax(0,1fr)]
```

### Status Indicators

```
<span class="h-2 w-2 rounded-full bg-emerald-500" />  -- ok
<span class="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />  -- pending
<span class="h-2 w-2 rounded-full bg-red-500" />  -- error
<span class="h-2 w-2 rounded-full bg-zinc-500" />  -- inactive
```

### Focus-Visible Ring

All interactive elements must show a focus ring for keyboard navigation. Use `focus-visible` (not `focus`) to avoid showing rings on mouse click:

```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950
```

The `ring-offset-zinc-950` matches the page background, creating a gap between the element and the ring for visual clarity.

---

## 9. Rendering Patterns

Two rendering approaches are supported. The rendering model is a **per-project architectural choice** -- they share the same visual design and component structure regardless.

### Client-Side SPA (anvil, flamemail)

- `react-router-dom` for client-side routing
- Static `index.html` with `<div id="root">`
- `ReactDOM.createRoot` in `main.tsx`
- `BrowserRouter` wraps the app
- Routes defined in `app.tsx` using `<Routes>` / `<Route>`
- `app-shell.tsx` uses `<Outlet />` for nested route rendering

### Server-Side Rendering + Islands (git-on-cloudflare)

- `react-dom/server.renderToReadableStream()` on Cloudflare Workers
- `itty-router` for server-side routing (all navigation is full-page loads)
- Per-page entry bundles listed in `entries/` and mapped via `server/registry.tsx`
- `IslandHost` serializes props as `<script type="application/json">` for client hydration
- Only interactive "island" components are hydrated via `hydrateRoot()`
- Static React components are rendered server-side and never hydrated
- `server/document.tsx` generates the full `<html>` shell (no `index.html`)

---

## 10. SPA Entry Point Pattern

### `main.tsx`

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "@/client/app";
import "@/client/styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

Context providers (auth, toast, etc.) wrap inside `<StrictMode>` as needed.

### `app.tsx`

Contains **only** route definitions. No layout, no state, no component logic.

```tsx
import { Route, Routes } from "react-router-dom";
import { AppShell } from "@/client/components/app-shell";
import { HomePage, AboutPage, NotFoundPage } from "@/client/pages";

export const App = () => (
  <Routes>
    <Route element={<AppShell />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes>
);
```

---

## 11. State Management

- **No external state libraries** -- all projects use React built-in primitives:
  - `useState`, `useCallback`, `useRef`, `useEffect`
- Custom hooks encapsulate domain logic (e.g., `useInbox`, `useWebSocket`, `useCountdown`)
- Local state preferred; global state only via module-level singletons (toast) or context
- `localStorage` for session persistence and theme preference

---

## 12. Project Conventions

### Formatting

- **Prettier** for code formatting (`.prettierrc` + `.prettierignore`)
- Scripts: `format` (write) and `format:check` (CI check)

### Build Output

- Output directory: `dist/`
- `emptyOutDir: true` in Vite config

### Dev Server

- `host: true` (listens on all interfaces)
- Custom watch filters to ignore non-source files

### Deployment

- Cloudflare Workers via `wrangler deploy`
- Database migrations run before deploy where applicable
- Custom domains configured in `wrangler.jsonc`

---

## 13. Accessibility

### Baseline

Every project must meet **WCAG 2.1 AA** as a minimum. Accessibility is not a follow-up task — it ships with the feature.

### Semantic HTML

Use the correct element for the job. `<button>` for actions, `<a>` for navigation, `<input>` for form fields. Never attach click handlers to `<div>` or `<span>` — use a `<button>` with `variant="ghost"` if you need an unstyled clickable.

Landmarks (`<header>`, `<nav>`, `<main>`, `<footer>`, `<aside>`) must be present and used correctly in the app shell. There should be exactly one `<main>` per page.

### Keyboard Navigation

- All interactive elements must be reachable via **Tab** in a logical order
- `focus-visible` rings are mandatory on every interactive element (see Section 8 — Focus-Visible Ring)
- Modal dialogs must **trap focus** — Tab cycles within the dialog until it is dismissed
- Pressing **Escape** must close modals, dropdowns, and popovers
- Custom components (dropdowns, menus, tabs) must implement the [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/patterns/) keyboard patterns for their role

### ARIA

- Prefer semantic HTML over ARIA — `aria-*` attributes are a supplement, not a substitute
- Icon-only buttons must have `aria-label` (e.g., `<button aria-label="Close"><X /></button>`)
- Loading states must use `aria-busy="true"` on the container and `aria-live="polite"` for dynamic content updates
- Toast notifications must use `role="status"` and `aria-live="polite"` (or `aria-live="assertive"` for errors)
- Form inputs must be associated with their labels via `htmlFor`/`id` — never rely on placeholder text as the only label
- Error messages must be linked to their input via `aria-describedby`
- Expandable sections (accordions, dropdowns) must use `aria-expanded`
- Decorative icons use `aria-hidden="true"`; informational icons need accessible text

### Color Contrast

| Element                                   | Minimum ratio | Standard                 |
| ----------------------------------------- | ------------- | ------------------------ |
| Body text (`zinc-100` on `zinc-950`)      | 4.5:1         | AA normal                |
| Secondary text (`zinc-400` on `zinc-950`) | 4.5:1         | AA normal                |
| Muted text (`zinc-500` on `zinc-950`)     | 3:1           | AA large / UI components |
| Interactive controls (borders, icons)     | 3:1           | AA UI                    |

Never rely on color alone to communicate state. Pair color with an icon, label, or pattern:

```
✓  <Badge variant="error"><AlertCircle size={14} /> Failed</Badge>
✗  <span className="text-red-400">Failed</span>   ← color is the only signal
```

### Reduced Motion

Respect the user's `prefers-reduced-motion` preference. Add this to `app.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

This disables all entrance animations, staggered reveals, hover transitions, and shimmer effects in one rule. Do **not** add per-element motion queries — the global rule covers everything.

### SPA Route Changes

Client-side navigation does not trigger a browser page load, so screen readers must be notified:

- Set `document.title` on every route change
- Move focus to the page's `<h1>` or a skip-target on navigation (prevents the reader from restarting at the top of the DOM)
- Announce route changes with a visually-hidden `aria-live="polite"` region

### Skip Link

Every project must include a skip-to-content link as the first focusable element in the DOM:

```tsx
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:rounded-lg focus:bg-zinc-900 focus:px-4 focus:py-2 focus:text-accent-400 focus:ring-2 focus:ring-accent-500/50"
>
  Skip to content
</a>
```

The `<main>` element must have `id="main-content"` to receive the skip target.

### Images & Media

- All `<img>` elements must have an `alt` attribute — descriptive for content images, `alt=""` for decorative ones
- Videos must have captions or a text transcript
- SVG icons used inline must have `aria-hidden="true"` when decorative, or `role="img"` + `<title>` when informational
