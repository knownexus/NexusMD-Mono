# Nexus Community Design System

A design system for **Nexus Community** — a whitelabel community web platform for gaming groups, LARPs, tabletop communities, living-history societies, and similar fan/social organisations. **Nexus** is the company / author; **Nexus Community** is the product.

The product bundles user management, forums, wikis, event planning, document libraries, announcements, and character rosters into a single themable platform. Because the platform is **whitelabel**, every community deployment picks its own name, tagline, colour palette, fonts, and email domain through a **brand profile** — a JSON definition the platform applies at runtime by injecting CSS variables on `:root`.

This design system documents:

1. The **Nexus** platform brand itself — the logo, wordmark, and "this is who built the platform" identity.
2. The **brand-profile system** — ten ready-made profiles in `brand-profiles/profiles.css`, each scoped to `:root[data-brand="<slug>"]` so they can co-exist in a single stylesheet and switch live.
3. The **shared design foundations** that survive across every profile — type system, spacing scale, radii, shadows, motion, component anatomy.
4. A **working web UI kit** at `ui_kits/web/` that lets you click through the product (Login, Home, Forum, Events, Wiki, Characters, Admin, Analytics) and flip between every brand profile from a floating switcher.

---

## What you'll find here

| File / folder | What it is |
|---|---|
| `README.md` | This file. Brand context + content + visual + iconography fundamentals. |
| `SKILL.md` | Agent-skill front-matter so this folder can be dropped into Claude Code as a skill. |
| `colors_and_type.css` | Base typography + element styles. Imports the **default** (un-attributed) `:root` from `brand-profiles/profiles.css`. **Import this in any artifact.** |
| `components.css` | Real component chrome (buttons, cards, forms, badges, alerts, nav-pills, modal, table, sidebar nav-link). Imports `colors_and_type.css`. |
| `brand-profiles/` | **The brand-profile system.** Ten themes scoped to `:root[data-brand="<slug>"]` — switch with one attribute. See `brand-profiles/README.md`. |
| `fonts/` | `Cardinal-Regular.woff` — the one self-hosted typeface (Historia Normannis only). Other webfonts (Cinzel, Crimson Pro, Inter, Cinzel Decorative, Gentium Plus, Cormorant Garamond, Spectral) load from Google Fonts. |
| `assets/` | Static brand assets — the Nexus platform logo + variants, the community hex emblem, four pattern tiles (rhombus, shards, manuscript, botanical, amethyst), the icons cheat-sheet. |
| `preview/` | One small HTML card per design-system concept + one per brand profile. Surfaces in the Design System tab. |
| `ui_kits/web/` | Interactive click-through prototype of the Nexus web app, with a brand-switcher in the bottom-right. |

---

## Brand profiles at a glance

Detail in [`brand-profiles/README.md`](brand-profiles/README.md). Ten profiles ship in `brand-profiles/profiles.css`:

| Slug | Family | Mood |
|---|---|---|
| `nexus-default-dark` ★ | Nexus Default | Warm navy + antique gold. Heritage / guild noticeboard. |
| `nexus-default-light` | Nexus Default | Parchment + darkened gold. Reading room by day. |
| `shattered-realms-dark` | Shattered Realms | Deep midnight blue + bronze. Cracked plate armour, candle-lit hall. |
| `shattered-realms-light` | Shattered Realms | Pale slate-stone + bronze. Same broken kingdom by day. |
| `historia-normannis-light` | Historia Normannis | Manuscript scribal. Red ink on warm linen. |
| `historia-normannis-dark` | Historia Normannis | Aged parchment by candlelight. Warm red on sepia. |
| `amethyst-court-dark` *(suggested)* | Amethyst Court | Arcane / scholarly. Obsidian + amethyst violet. |
| `amethyst-court-light` *(suggested)* | Amethyst Court | Pale lavender + deep violet ink. |
| `cobalt-lodge` *(suggested)* | Cobalt Lodge | Quietly modern slate + cobalt blue. No fantasy serif. |
| `verdant-reach` *(suggested)* | Verdant Reach | Botanical, outdoorsy. Cream + moss green. |

★ = system default (matches the un-attributed `:root` selector). To switch profile:

```html
<html data-brand="historia-normannis-dark">
```

Or live, in the UI kit, via the floating brand switcher in the bottom-right corner.

---

## Sources

- **`NexusWebsiteTemplate/`** — full .NET / Blazor Server codebase, including:
    - `src/Nexus.API/brand-profiles/*.json` — the **canonical brand-profile JSON definitions** for Shattered Realms, Historia Normannis, and Historia Normannis Dark.
    - `src/Nexus.SharedKernel/Application/DTOs/BrandProfileDto.cs` — the full schema (~30 colour + 4 font fields + a terminology dictionary).
    - `src/Nexus.API/Controllers/BrandProfilesController.cs` + `src/Nexus.API/Services/BrandProfileService.cs` — runtime CRUD + activate/deactivate.
    - `src/Nexus.Web/Components/App.razor` — runtime CSS-variable injection and dynamic Google-Fonts loader.
    - `src/Nexus.Web/wwwroot/css/modern-styles.css`, `shared-components.css` — the workhorse stylesheets.
    - `src/Nexus.Web/Components/Layout/{MainLayout,NavMenu}.razor` + per-page CSS.
    - `src/Nexus.Web/Components/Pages/Admin/{Users,Roles,BrandProfiles}.razor` — the admin screens that the UI kit recreates.
    - `src/Nexus.Web/Components/Pages/Analytics/*.razor` — analytics surfaces.
    - `src/Nexus.Web/Resources/UiStrings.cs` — every piece of UI copy (best single source for tone of voice).
    - `CLAUDE.md` — architecture + branding notes.

The two suggested profiles (Amethyst Court, Cobalt Lodge, Verdant Reach) are net-new additions designed to broaden the catalogue beyond fantasy/heritage communities.

---

## What's new vs the first draft

- **Nexus has a real logo now.** A geometric mark — three satellites converging on a central nexus inside a thin ring — with three variants (Primary, Solid, Outline, Stamped). See `assets/logo/` and `preview/nexus-logo.html`. Adapts to any brand colour via `currentColor` when embedded inline.
- **Ten brand profiles** (was one). Six map to your existing JSON in the API; four are suggested additions.
- **Light/dark pairs** for every fantasy family (Nexus Default, Shattered Realms, Historia Normannis, Amethyst Court) — fonts identical within a pair, hue identical, only surface temperature varies.
- **Shattered Realms is now distinct from Nexus Default**: deep midnight blue + bronze (dark-ages), not gold + navy.
- **The UI kit has a live brand switcher** — open `ui_kits/web/index.html`, look bottom-right.
- **Admin (Users, Roles, Brand Profiles) and Analytics screens** are built into the UI kit, not placeholders.

---

## Content fundamentals

### Voice

Nexus speaks like a **community-platform admin who happens to read a lot of fantasy**: warm, plainly written, occasionally evocative — never breathless or salesy. The product is utilitarian (it's a forum + wiki + calendar), but the framing is heritage / world-building.

- **Person:** Mostly imperative or second-person. "Engage with the community.", "Discover the chronicles…", "Create and manage your in-world identities."
- **You vs. I:** "You" addresses the member ("New to {community}? Create an account"); the app never says "I". The platform is named, not personified.
- **Formality:** Reserved-and-clear. No marketing exclamation. No "Welcome back, friend!" pleasantries. No corporate "Let's get started."
- **Sentence length:** Short and declarative for buttons/empty states. One mid-length sentence + a short follow-on for feature descriptions.

### Casing

- **Page titles, button labels, badges, table headers, eyebrows, nav-section dividers:** **Title Case** for proper nouns ("My Characters", "Event Calendar"), but the small uppercase tracked treatment is reserved for **categorisation** (nav section dividers, card-header eyebrows, badges, table column heads) — not for body copy.
- **Body / paragraphs / descriptions:** Sentence case. "Engage with the community. Discuss lore, strategy, and the latest events across all realms."
- **Form labels:** Tracked uppercase, very small (0.75rem), via `.form-label`. Helps them recede.
- **Headings (h1–h5):** Title case in Cinzel. Letter-spacing 0.03em — *slightly* open but not full small-caps.

### Tone examples (lifted verbatim from `UiStrings.cs` and the Home page)

| Surface | Copy |
|---|---|
| Tagline (Home hero) | "The world awaits. Join the adventure." |
| Login subtitle | "Enter your credentials to continue" |
| Forum card | "Engage with the community. Discuss lore, strategy, and the latest events across all realms." |
| Wiki card | "Discover the chronicles of the community. Lore, guides, and history — written by the community." |
| Events card | "Join community gatherings, raids, and tournaments. Mark yourself as going and track upcoming activities." |
| Characters card | "Create and manage your in-world identities. Track your roster and progression." |
| Empty / unavailable | "{Feature} Unavailable" / "The {feature} feature is not enabled on this platform." (factual; no apology) |
| Awaiting approval | "Your account is awaiting admin approval. You will be able to sign in once an administrator has reviewed your registration." |

Notice "in-world", "chronicles", "realms", "gatherings", "raids" — fantasy-adjacent vocabulary, but the structure is administrative.

### Emoji & punctuation

- **No emoji anywhere.** Not in copy, not in icon contexts, not in empty states. Cosmetic atmosphere comes from typography and gold-on-navy colour, not from glyphs.
- **No exclamation marks** in default copy.
- **Ellipsis** (`...` written literally, not `…`) used for in-progress states: "Loading...", "Saving...", "Sending...".
- **Em-dashes** are fine in editorial copy. The platform uses ASCII `-` in inline text and the em-dash character `—` in section dividers / fancier copy.
- **Single quotes** for inline emphasis when needed; double quotes for actual quotation. Apostrophes are typographic where natural ("you're", "we'll").

### Terminology

The visible nouns flex per-brand (a community can rename "Characters" to "Roster" via a brand-dictionary feature), but the default lexicon is:

- **Community** (not "site", "group", "team", "organisation")
- **Member** is used as a synonym for **User** in member-facing copy; "User" appears only in admin contexts.
- **Forum / Threads / Posts**, **Wiki / Pages**, **Events**, **Announcements**, **Characters**, **Documents**, **Roles**, **Permissions** — domain nouns line up with the code's domains.
- **Sign In** (two words), not "Log In". **Sign Out**, not "Log Out".

---

## Visual foundations

### Overall mood

Dark, restrained, **heritage / fantasy-adjacent**. Imagine a guild-hall noticeboard rendered in CSS: a near-black ground, parchment-coloured text, a single gold accent that does almost all the work, and a single self-hosted serif (Cinzel) carrying the brand voice. The aesthetic is decidedly **not** cyberpunk, not glassmorphism, not neon — it's closer to a hand-stamped book cover or a tabletop publication.

### Colour

- **Palette is dark-first and monochromatic+1.** Two foundational hues:
    - A cool **near-black navy** (`#07090f` → `#182132`) for canvases, surfaces, and borders. Borders sit at `#1c2a3e` — desaturated, slightly bluer than the surfaces so they read as edges, not seams.
    - A single warm **antique gold** (`#c9a84c`) for accents. Brighter (`#e8c76a`) for hover/highlight; dimmer (`#7d6830`) for borders and disabled states; `#967519` is reserved as the mid-stop in the primary-button gradient.
- **No second accent hue.** Semantic colours (red, green, blue, orange) exist for `danger`, `success`, `info`, `warning` but never appear as decoration — only on alerts, validation, and small badges.
- **Text is parchment**, not white: `#d8cdb8` body / `#f0e8d8` bright. Muted text shifts to **cool desaturated blue** (`#5e7189`), which sets up gentle warm-vs-cool contrast against the navy ground.
- **Tinted backgrounds** (`var(--accent-muted)`, ~12% alpha gold) are the workhorse for "selected", "going", restricted-access badges. Tints, not solid fills.

### Typography

- **Cinzel** (Google Fonts) for all headings, brand name, eyebrow labels with capital letters. It's a Roman-inscription serif; reads as old and ceremonial but stays readable at small sizes.
- **Crimson Pro** (Google Fonts) for body, descriptions, paragraphs, table cells. Quietly bookish; pairs with Cinzel without clashing.
- **Inter** (Google Fonts) for UI chrome — buttons, form labels, badges, breadcrumbs, anything Title-Cased-or-Uppercase-and-Small. Inter is doing the "this is functional UI, not editorial" job.
- **Cardinal** (self-hosted, `.woff`) is included but used sparingly — reserved for very large masthead/cover-page treatments. Treat it as optional.
- All three Google Fonts load **at runtime** via `App.razor` parsing the first family from the branding stack — meaning anyone can swap them per-community by editing `appsettings.json`. **No font substitutions are needed**; all three are free on Google Fonts and the Cardinal woff is included.

### Spacing & rhythm

The codebase uses Bootstrap-style utility classes (`.gap-2`, `.mb-3`, `.p-5`) plus a rough `rem` scale. Canonical values:

| Token | Pixels | Used for |
|---|---|---|
| `0.25rem` | 4 | inline gap (badge to icon) |
| `0.5rem` | 8 | small gaps, badge padding |
| `0.75rem` | 12 | row gaps in lists |
| `1rem` | 16 | default form padding, gap-3 |
| `1.5rem` | 24 | card padding, section gap |
| `2rem` | 32 | page heading bottom margin |
| `3rem` | 48 | hero padding |

Cards: 1.5rem padding. Page-header bottom margin: 2rem + 1px gold-tinted divider. Stat-card padding: 1.5rem. The `article.content` wrapper sits inside `max-width: 1400px` with 2rem horizontal gutter.

### Backgrounds & patterns

- **No photography**, no illustration, no full-bleed imagery in the template. Imagery would come in via user-uploaded **event banners** (160px tall, cover-fit, fallback to a navy diagonal-gradient placeholder).
- **A signature subtle pattern**: a 60–80px **rhombus tile** of gold (`#c9a84c`) at 3–3.5% alpha, applied to the sidebar (blended with a top-down navy gradient) and the login page. This is the only decorative texture in the system. It reads as a faint heraldic diaper pattern.
- **Hero ambience**: the login page also gets a radial gold glow at the top (`ellipse 80% 60% at 50% 0%, rgba(201,168,76,0.07)`) plus a 160° gradient that fades from a 4%-gold tint top-left into a 6% cool-blue (`rgba(41,80,140,0.06)`) bottom-right. Used **once**, to make the entry view feel ceremonial.
- **The hex emblem** on Home is an inline SVG (six-sided star polygon nested twice, with bisecting lines and a central dot) drawn in `var(--accent)`. It rotates **once every 30 seconds**. This is the closest the template has to a logo.

### Borders

- **Always 1px**, never 2px. Default `var(--border)` (`#1c2a3e`). Subtle dividers use `var(--border-subtle)` (`#111c2b`).
- **Hover** raises border opacity to gold (`color-mix(in srgb, var(--accent) 40%, transparent)`), often combined with a soft outer shadow.
- **Active / selected** uses solid accent gold for the border (often paired with `accent-muted` background tint).
- Corner radii (see Spacing section): `4px` (form-control-sm, badge), `8px` (default form, button), `10px` (event card, section card), `12px` (card, modal), `16px` (modal-content).
- A signature one-pixel **vertical gold gradient line** sits on the sidebar's right edge, fading in at 30% height and out at 70% — a slim "ceremonial" trim.

### Shadows / elevation

Conservative, multi-stop, slightly heavy because the canvas is so dark:

- `--shadow-sm`: `0 1px 3px rgba(0,0,0,0.5)` — default for cards, tables, inputs.
- `--shadow-md`: `0 4px 12px rgba(0,0,0,0.6)` — card hover.
- `--shadow-lg`: `0 12px 32px rgba(0,0,0,0.7)` — modals, the login card.
- `--shadow-accent`: `0 0 16px var(--accent-border-glow)` — paired with hover shadow on primary buttons and the login card.
- **No inner shadows** in the system. Depth is signalled by background-colour stepping (`page-bg` < `container-bg` < `card-bg` < `card-raised`) more than by shadows.

### Focus rings

A double-stop ring that reads cleanly on dark: `box-shadow: 0 0 0 2px var(--page-bg), 0 0 0 4px var(--accent-dim)`. The inner page-bg layer keeps the gold ring 2px clear of the focused element. Applied to `.btn`, `.form-control`, `.form-check-input`, and `.btn-link.nav-link`.

### Hover & press states

- **Buttons (primary)**: a 200%-width 3-stop gold gradient (`accent-mid → accent → accent-mid`). Hover shifts `background-position` from `0% 0` to `100% 0`, adds the gold glow shadow, and applies `transform: translateY(-1px)`. No press-down state — the lift stays.
- **Buttons (secondary / outline)**: hover lightens background (`container-raised` → `container-hover`) and saturates the border/text toward `accent` or `text-bright`. No transform.
- **Cards**: hover shifts border from `--border` to `--accent-border-glow` and adds `--shadow-card-hover`. Some cards also `translateY(-1px)` to `-2px`.
- **Nav items**: hover paints a 6%-gold background tint, brightens the text, and slides a 2px gold left-edge bar in from `scaleY(0)` to `scaleY(0.5)`. Active state takes that bar to `scaleY(1)` and uses 10%-gold background. **Signature interaction** — this is the most distinctive piece of motion in the system.
- **Press**: rarely defined. No active-state `scale(0.98)` or darker fill. The system trusts hover to do the work.
- **Links**: hover shifts colour `accent → accent-bright` (`#c9a84c → #e8c76a`). No underline.

### Motion

- **Easing**: `cubic-bezier(0.4, 0, 0.2, 1)` (Material-style) for chevrons and panels. `ease` for hovers. Durations: `0.15s` (link colour), `0.18s` (default), `0.22–0.25s` (panel expand, sidebar collapse).
- **No bounce, no spring**. Nothing overshoots.
- **Animations**:
    - Sidebar collapse: width transitions `250px ↔ 60px` over `0.25s`.
    - Nav-section accordion: `max-height: 500px ↔ 0` with opacity fade over `0.24s`.
    - Loading orb: standard 2px-ring spinner, `0.8s linear infinite`.
    - Home emblem: `30s linear infinite` rotation — barely perceptible.
    - Announcement banner entry: `slide-down 0.3s ease` (translateY from -100% to 0 + opacity).
    - Sidebar items' left-edge gold bar: scale on hover/active as described above.

### Transparency & blur

- **Modal backdrop** is the one place blur appears: `background: rgba(4,6,10,0.85)` + `backdrop-filter: blur(4px)`. Heavy enough to obliterate the page behind without going opaque.
- **Accent muted tints** (`rgba(201,168,76,0.06–0.12)`) are used everywhere for "active / restricted / going" backgrounds.
- **`color-mix(in srgb, var(--accent) N%, transparent)`** is the canonical way to derive a tinted variant on the fly — see borders, hover states, badge fills. Get comfortable with it; it's all over the codebase.

### Cards

Three flavours:

1. **`.card`** — default. `var(--card-bg)` (`#0f1721`), 1px `--border`, `var(--radius-lg)` (12px), `--shadow-sm`. Hover lifts border to gold-glow and stacks `--shadow-md` + `--shadow-accent`.
2. **`.stat-card`** — same surface, but with a **subtle gold radial glow** baked into the top-right corner (an 80x80 `radial-gradient(circle, var(--accent-muted) 0%, transparent 70%)` pseudo-element). Used for dashboard summary tiles. Value text is gold and large; title is muted uppercase Inter.
3. **`.home-feature-card`** — taller (2rem padding), text-centered-or-left, with a 40×40 gold-stroked SVG icon at the top. Hover translates -2px and adds the gold glow.

Card **headers** (when present) are visually distinct: `var(--card-raised)` background, Inter, uppercase, tracked, gold — they look like signage strips. Card **bodies** are paragraphic Crimson Pro.

### Layout rules

- **Sidebar-left, content-right**, fixed across desktop. Sidebar is `250px` expanded or `60px` collapsed. Sticky to the viewport, scrolls internally if nav overflows.
- **Mobile (≤640px)**: sidebar collapses into a top hamburger; content gets 1rem horizontal padding instead of 2rem.
- **Content max-width**: `1400px`, centered, with 2rem horizontal padding on desktop.
- **Page header bar** (`.page-header` or `.page-header-bar`): title left, action buttons right, separated by a 1px `--border` divider with 2rem bottom margin. The title may use either a gradient gold (`page-header h1`) or solid bright-text (`.page-header-bar__title`).
- **Sticky / fixed elements**: only the sidebar (sticky), the toggle button (absolute, riding the sidebar's right edge), and the Blazor error UI (fixed bottom).

### Iconography is its own section below.

---

## Iconography

### What's used

- **24×24 line-art SVG icons**, drawn inline in the Razor source. They follow **Feather / Lucide convention exactly**: 24×24 viewBox, `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, `fill="none"` (rare exceptions use `fill="currentColor"` — e.g. the home glyph and small dots in the calendar icon).
- The Home page renders nav-feature icons at **40×40** with `stroke-width="1.5"` — same vocabulary, slightly thinner for hero use. Sidebar nav icons render at **15×15** with `opacity: 0.6` (rising to 1.0 on hover/active).
- **No icon font** is bundled. **No PNG icon set** is bundled. **No emoji** appear in icon contexts.
- **Unicode glyphs** appear in two narrow places: the breadcrumb separator (`›`, chevron right) and a checkbox tick drawn with a CSS pseudo-element (not a glyph). Section-header chevrons in the sidebar are inline 10×10 SVG.
- **The Google "G" logo** appears once on the login page as a 20×20 inline coloured SVG. That is the only multi-coloured icon in the system.

### Recommended replacement for ad-hoc work

Since the icons are stylistically identical to **Lucide** (the modern fork of Feather), the cleanest approach for new artifacts is to **load Lucide from CDN** and use the matching name:

```html
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
```

The `assets/icons.md` cheat-sheet maps the Razor inline SVGs to their Lucide equivalents (e.g. `home`, `shield` for Characters, `calendar` for Events, `message-square` for Forum, `book-open` for Wiki, `file-text` for Documents, `users`, `bar-chart-2` for analytics, `settings`, `log-out`, `log-in`, `user-plus`).

> **Substitution flagged:** Lucide is a 1:1 stylistic stand-in for the codebase's hand-rolled Feather-style icons. If you want pixel-perfect parity for production, lift the SVGs from the Razor source directly. For prototypes and mocks, Lucide is the right call.

### Brand mark

The closest thing to a logo is the **hex emblem** drawn on `Home.razor`: nested hexagons with diagonal bisectors and a centred filled dot, in `var(--accent)` at various opacities, rotating 360° every 30 seconds. It's preserved as `assets/nexus-emblem.svg` (extracted from the source — static, no animation; rotate it in CSS at the call-site if you want it spinning). The favicon is at `assets/favicon.png` (32×32). There is **no proper wordmark**; the community name is set in Cinzel and acts as the wordmark (with the first letter optionally tinted gold via `::first-letter { color: var(--accent-initial); }`).

---

## Component fundamentals (overview)

The full implementations live in `ui_kits/web/` as React/JSX recreations. The cards in `preview/` show each component in isolation. Quick map:

| Component | File / preview |
|---|---|
| Buttons (primary, secondary, danger, outline, gold gradient) | `preview/buttons.html` |
| Forms (inputs, labels, validation, checkboxes) | `preview/forms.html` |
| Cards (default, stat, feature) | `preview/cards.html` |
| Badges & alerts | `preview/badges.html`, `preview/alerts.html` |
| Nav pills | `preview/nav-pills.html` |
| Sidebar nav | `ui_kits/web/Sidebar.jsx` |
| Modal | `preview/modal.html`, `ui_kits/web/Modal.jsx` |
| Tables | `preview/table.html` |
| Hex emblem & brand mark | `preview/brand-mark.html`, `assets/nexus-emblem.svg` |

---

## Index

- **Foundations** — read these first.
    - `README.md` (you are here)
    - `colors_and_type.css` — base typography. Imports the default `:root` from `brand-profiles/profiles.css`. **Import in every artifact.**
    - `components.css` — component chrome. Imports `colors_and_type.css`.
    - `brand-profiles/profiles.css` + `brand-profiles/README.md` — ten themes, scoped to `[data-brand]`.
    - `SKILL.md` — agent skill metadata.
- **Visual assets** — `assets/`
    - `logo/nexus-mark.svg`, `nexus-mark-solid.svg`, `nexus-mark-outline.svg`, `nexus-mark-stamped.svg` — the platform mark, four weights.
    - `logo/nexus-wordmark.svg`, `logo/nexus-lockup.svg` — wordmark + horizontal lockup.
    - `nexus-emblem.svg` — the per-community hex emblem (used on Home heroes).
    - `favicon.png`
    - `pattern-rhombus.svg`, `pattern-shards.svg`, `pattern-manuscript.svg`, `pattern-botanical.svg`, `pattern-amethyst.svg` — texture tiles, one per brand family.
    - `icons.md` — Razor inline-SVG → Lucide name mapping.
- **Web font** — `fonts/Cardinal-Regular.woff` (Historia Normannis display)
- **Preview cards** — `preview/*.html`. Surfaced in the Design System tab.
- **UI kit (web app)** — `ui_kits/web/`
    - `index.html` — interactive prototype with a live brand-switcher.
    - Components: `Sidebar.jsx`, `Login.jsx`, `Home.jsx`, `Forum.jsx`, `Events.jsx`, `Wiki.jsx`, `Characters.jsx`, `AdminUsers.jsx`, `AdminRoles.jsx`, `AdminBrandProfiles.jsx`, `Analytics.jsx`, `Modal.jsx`, `Placeholder.jsx`, `BrandSwitcher.jsx`, `icons.jsx`.
    - Glue: `app.jsx` (router + auth state), `kit.css` (layout-specific styles).

---

## Caveats & known gaps

- The **Cardinal font** is included but only used by the Historia Normannis profiles. If you don't deploy those, drop the `@font-face` block.
- **Icons are hand-inlined SVGs in the codebase.** The UI kit substitutes Lucide-equivalent inline SVGs in `icons.jsx`; a production fork should consider exporting them as a sprite or React icon set.
- The **community hex emblem** (`assets/nexus-emblem.svg`) is the same in every brand profile. In production this would likely be per-community — each brand profile could ship its own SVG emblem.
- **Pattern textures** are colour-baked into the SVG (gold, bronze, red, green, violet) — they don't dynamically pick up `currentColor`. If you want per-brand re-tinting at runtime, switch from `background-image: url(...)` to `mask-image: url(...)` + a coloured background-color. Trade-off: slightly more CSS, but full colour control.
- **No marketing/landing surface** was in the source — only logged-in product UI. The Nexus platform mark is built for that gap (it can sit on a marketing site) but a full marketing brand kit isn't here.
