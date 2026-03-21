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

## 3. Styling

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

Default transition duration is overridden to **75ms** via `--default-transition-duration` in `@theme` (Tailwind default is 150ms, which feels sluggish on hover). Do not use `hover:brightness-*` on gradient buttons -- it forces the GPU to recompute the filtered gradient each frame. Use a color swap instead (e.g., `hover:from-accent-400 hover:to-accent-500`).

### Performance

- **Ambient glow**: apply the radial-gradient glow directly on `body`'s `background-image` alongside `background-color`. **Do not** use a `position: fixed` pseudo-element (`body::before`) — even with `will-change: transform`, a full-viewport fixed layer forces compositor blending against all scrolling content every frame, halving scroll frame rate (~33ms p50 vs ~16.7ms). Putting the gradient on `body` itself avoids the extra compositing layer entirely with no visual difference (the glow is ≤ 2% opacity).
- **`backdrop-blur-sm`** on sticky headers is acceptable. Prefer `backdrop-blur-sm` (4px) over `backdrop-blur-xl` (24px) — the larger radius is ~6× more expensive per frame and barely distinguishable at high background opacity. Pair with `bg-zinc-950/95` so the blur is cosmetic, not structural.

### Global CSS Template

Every project's `app.css` follows this exact structure. The **only** per-project differences are the `--color-accent-*` values and the ambient glow RGB values on `body`.

```css
@import "tailwindcss";

/* Dynamic class safelist (add @source inline(...) entries as needed) */

@theme {
  --default-transition-duration: 75ms;

  --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
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
    radial-gradient(circle at 20% 20%, rgba(<accent-rgb>, 0.02), transparent 50%),
    radial-gradient(circle at 80% 80%, rgba(<accent-rgb>, 0.015), transparent 50%);
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
| Primary CTA button      | `bg-gradient-to-r from-accent-500 to-accent-600 text-white shadow-lg shadow-accent-500/20` |
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

### Fonts

Loaded via Google Fonts `<link>` tags with `preconnect`:

| Font               | Weights            | Usage                            |
| ------------------ | ------------------ | -------------------------------- |
| **Inter**          | 400, 500, 600, 700 | Body text, UI elements, headings |
| **JetBrains Mono** | 400, 500           | Code blocks, monospace content   |

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
  rel="stylesheet"
/>
```

### Font Stacks (defined in `@theme`)

```css
--font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
--font-mono: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
```

---

## 6. Animations

Two standard animations are defined in every project:

| Name       | Duration | Easing   | Effect                                  |
| ---------- | -------- | -------- | --------------------------------------- |
| `fade-in`  | 0.4s     | ease-out | Opacity 0 to 1                          |
| `slide-up` | 0.35s    | ease-out | Opacity 0 + translateY(12px) to visible |

Usage:

- `animate-fade-in` -- applied to main content areas on page load
- `animate-slide-up` -- applied to page-level content wrappers for entrance transitions

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
- **Background**: `bg-zinc-950/80 backdrop-blur-xl` (dark), `bg-white/80 backdrop-blur-xl` (light)
- **Border**: `border-b border-zinc-800/60`
- **Container**: `max-w-7xl mx-auto px-4 sm:px-6`
- **Logo**: gradient icon (`rounded-lg bg-gradient-to-br from-accent-500 to-accent-600 shadow-lg shadow-accent-500/20`) + app name + subtitle
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

---

## 8. Component Patterns

### Reusable UI Primitives (`components/ui/`)

Every project must have a `components/ui/` directory with at least these components. They use `accent-*` tokens so they work identically across projects.

#### Button

Variants: `primary`, `secondary`, `danger`, `ghost`. Sizes: `sm`, `md`.

```
Primary:  bg-gradient-to-r from-accent-500 to-accent-600 text-white shadow-lg shadow-accent-500/20
Secondary: border border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700/60
Danger:   border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20
Ghost:    text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100
```

#### Card

Variants: `default`, `accent`.

```
Default: rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 sm:p-6
Accent:  rounded-2xl border border-accent-500/20 bg-gradient-to-br from-zinc-900/80 to-zinc-900/40 p-5 sm:p-6
```

#### Input

```
w-full rounded-xl border border-zinc-700/60 bg-zinc-800/80 px-4 py-2.5
text-zinc-100 placeholder:text-zinc-500
focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/30 focus:outline-none
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
