# Loontail Launcher — Redesign Design Brief

A decisive, build-ready synthesis of six parallel UI/UX research streams (Minecraft launchers, major game launchers, 2025 dark visual systems, motion/states, Electron/accessibility/density, brand aesthetics). Tailored to **one product**: a compact (1000×624), frameless, dark-only Electron app (React 19 + Tailwind v4) whose core job is a two-group ("My Builds" / "Official") catalog → detail → Play.

Every recommendation here is decided, not optioned, except §8 (three candidate directions with a named recommendation). Sources are linked inline.

---

## 1. Executive Summary — the 8–10 highest-leverage moves

1. **Adopt the genre-standard skeleton: thin left icon-rail + content area.** Every modern launcher (Steam, Battle.net, Riot, Modrinth) converged on this; Steam explicitly tuned it for narrow windows. It costs ~56–64px of width vs. a top-nav row that would steal scarce vertical pixels from a 624px-tall window. ([Steam](https://store.steampowered.com/libraryupdate), [Neowin](https://www.neowin.net/news/steams-new-library-ui-is-now-available-in-open-beta---heres-whats-changed/))
2. **Promote build detail from a modal to a full in-app route.** The detail view holds a hero, description, media gallery, server list, per-build settings, and persistent install progress — too much for a modal in a 624px window. Make it a routed page with a sticky hero header so PLAY is always reachable, and return focus cleanly on back. (Modrinth's tabbed instance *page* with sticky header is the model. ([Modrinth changelog](https://modrinth.com/news/changelog)))
3. **Make PLAY a single, vivid, state-machine button** (Install → Queued → Installing% → Update → Verifying → Ready/Play → Launching → Running → Retry). One primary only; progress renders *inside* the button in compact contexts. Never disable it silently — always show a reason + alternate action. ([Riot dynamic CTA](https://www.riotgames.com/en/news/new-riot-client-coming-soon), [NN/g button states](https://www.nngroup.com/articles/button-states-communicate-interaction/), [Smashing disabled buttons](https://www.smashingmagazine.com/2021/08/frustrating-design-patterns-disabled-buttons/))
4. **One entry point per build, landing on About.** Eliminate any Edit-vs-Settings ambiguity (GDLauncher Carbon's documented failure); put RAM/loader as **inline-editable tiles**, and shove Export/Duplicate/Delete into a three-dot overflow. ([Carbon issue #399](https://github.com/gorilla-devs/GDLauncher-Carbon/issues/399))
5. **Refine the existing monochrome-on-near-black look; do not reinvent it.** Add a disciplined surface ladder, tiered off-white text (never pure `#fff`), and exactly **one desaturated brand accent** reserved for PLAY + progress + active nav + focus. This single change makes the redesign read "expensive." ([Raycast DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/raycast/DESIGN.md), [Linear redesign](https://linear.app/now/how-we-redesigned-the-linear-ui))
6. **Glassmorphism is for chrome, not cards.** Reserve `backdrop-filter` for the title bar, nav rail, and detail hero scrim — never the scrolling catalog grid (GPU + legibility cost). Every glass text panel gets a **scrim fill** carrying the contrast; blur only carries the aesthetic. Verify 4.5:1 against the *lightest* region of `background.webp`. ([NN/g glassmorphism](https://www.nngroup.com/articles/glassmorphism/), [Axess Lab](https://axesslab.com/glassmorphism-meets-accessibility-can-frosted-glass-be-inclusive/), [FoundryVTT perf](https://github.com/foundryvtt/foundryvtt/issues/10400))
7. **Imagery carries "Minecraft," chrome stays clean.** Big per-build hero art is the visual identity; confine voxel/pixel motifs to the logo + one touchpoint. No pixel fonts in UI (illegible below ~16px). This is how Feather/modern Lunar feel Minecraft-y without looking childish. ([Lunar new launcher](https://www.lunarclient.com/news/the-new-launcher-is-here), [Looka Minecraft logo](https://looka.com/blog/minecraft-logo/))
8. **Home ≠ Library.** Home is a compact dashboard (one continue-playing hero + a horizontal recently-played strip, sorted by last-played); the catalog is the dense two-group grid. Auto-hide empty groups (show first-run prompt instead). ([Steam shelves](https://store.steampowered.com/libraryupdate), [Battle.net](https://wccftech.com/battle-net-update-biggest-in-years-layout-accessibility/))
9. **Install progress is the trust centerpiece:** determinate by default, phase label + percentage + smoothed speed/ETA, never moves backwards, explicit stall copy, Pause/Cancel adjacent, downloads in background, no auto-launch. Same state shown on card and detail from one source. ([Android Play Core](https://developer.android.com/guide/playcore/feature-delivery/ux-guidelines), [Page Flows](https://pageflows.com/resources/progress-bar-ux/))
10. **Cap motion: nothing over 250ms; everything `motion-safe:`.** Small window = short distances = fast transitions. Honor `prefers-reduced-motion` and `prefers-reduced-transparency` (swap glass for opaque). ([M3 motion](https://m3.material.io/styles/motion/overview/how-it-works), [NN/g animation duration](https://www.nngroup.com/articles/animation-duration/))

---

## 2. Information Architecture & Navigation

### Decision: Sidebar rail, not top tabs

Use a **persistent thin left icon-rail (~60px)**. This is the single most universal expectation across all seven major launchers and is the most space-efficient at 1000px wide. A top-nav row would stack with a hero and waste vertical space we cannot spare at 624px. ([Steam](https://store.steampowered.com/libraryupdate), [Neowin Steam](https://www.neowin.net/news/steams-new-library-ui-is-now-available-in-open-beta---heres-whats-changed/))

Rail items (icon + tiny caption to avoid Ubisoft's label-less, tooltip-less mistake ([gHacks](https://www.ghacks.net/2023/06/27/ubisoft-connect-beta-brings-a-new-interface-for-the-launcher-and-more-features/))):
- **Home** (dashboard)
- **Builds** (the catalog with both groups)
- **(pinned bottom)** Settings, Console
- Auto-updater badge + notifications live as a small **status cluster** in the title bar — never a reserved content rail (CurseForge's resizing-ad-rail anti-pattern). ([CurseForge idea](https://curseforge-ideas.overwolf.com/ideas/CF-I-1528))

**Hard rule:** no two nav items resolve to the same view (Epic's Home = Epic Games failure). Home and Builds are distinct. ([ResetEra](https://www.resetera.com/threads/the-epic-games-launcher-is-poorly-designed-and-is-a-major-turn-off.96514/))

### Decision: Build detail becomes a full route, NOT a modal

The current modal is overloaded (hero, about, media gallery, server list, install progress, PLAY, per-build settings). The cross-launcher convention is a **cinematic per-item page**, and Modrinth specifically uses a **tabbed instance page with a sticky header**. ([Modrinth changelog](https://modrinth.com/news/changelog), [Riot](https://www.riotgames.com/en/news/new-riot-client-coming-soon))

- Clicking a build card navigates to `/builds/:id` and lands **directly on About/Overview** — no Settings detour (Carbon failure). ([Carbon #399](https://github.com/gorilla-devs/GDLauncher-Carbon/issues/399))
- **Sticky hero header** keeps the build title + PLAY pinned while the body scrolls — critical in 624px height.
- Body = **icon+label tabs**: About · Media · Servers · Settings. (Modrinth's icon-beside-label pattern aids scanning.)
- A back affordance (and Esc / mouse-back) returns to the catalog with scroll position + focus restored.

> If routed pages are infeasible short-term, the fallback is a **near-full-window sheet** (not a small centered modal) with the same sticky-hero + tabs structure and a focus trap. But the route is the recommendation.

### Home vs Library structure

- **Home** = compact dashboard: one **"Continue" hero** (last-played build, big PLAY) + a single horizontal **recently-played strip** sorted by last-played, reflowing column count by width. Matches the committed-HEAD compact-horizontal-cards direction. ([Steam](https://store.steampowered.com/libraryupdate))
- **Builds** = the dense catalog: two **collapsible accordion groups** ("My Builds" / "Official") on one scroll, with a **grid/list toggle** and a **single search box spanning both groups** (Carbon's unified search; don't force a tab choice first). Auto-hide an empty group and show its first-run prompt instead. ([GDLauncher Carbon](https://github.com/gorilla-devs/GDLauncher-Carbon))
- **Official** group gets store-grade hero imagery + hover motion (storefront feel); **My Builds** can be denser. ([Lunar Explore page](https://www.lunarclient.com/news/the-new-launcher-is-here))

---

## 3. Layout & Density for 1000×624

The "cramped" feeling comes from inconsistent spacing, not small size. Density is deliberate tuning of type + space, per-section, not global. ([Designsystems.com](https://www.designsystems.com/space-grids-and-layouts/), [EightShapes](https://medium.com/eightshapes-llc/space-in-design-systems-188bcbae0d62))

### Window budget
```
1000 px wide  ×  624 px tall
├─ Title bar: 36 px (full width)                     → 588 px remains tall
├─ Left rail: 60 px                                  → 940 px remains wide
├─ Content area: 940 × 588 (approx, minus 16px gutters)
└─ Bottom download strip (collapsed): 32 px when active; expands on click
```

### Grid & spacing
- **4px base grid**, rhythm 4 / 8 / 12 / 16 / 24 / 32. Line-heights divisible by 4. ([Microsoft spacing](https://learn.microsoft.com/en-us/windows/apps/design/style/spacing), [Carbon](https://carbondesignsystem.com/elements/spacing/overview/))
- **Catalog grid: 3-up** compact cards in ~940px usable. At `gap: 12px` (`gap-3`) and 16px page gutters, cards land ~296px wide — enough for a 16:9 thumbnail + title + one meta row. A 2-up "featured" row for Official can sit above a denser 3-up My Builds grid.
- **Page gutter:** 16px (`p-4`). **Card padding:** 12px. **Internal spacing ≤ external** so groups read as groups (`cieden` rule). ([Cieden](https://cieden.com/book/sub-atomic/spacing/spacing-best-practices))
- **Row heights** on 8px multiples: 56 / 64 / 72px.

### Density rules
- **Don't go below 12px** text; 13–14px body/descriptions. Reserve wide-tracked uppercase micro-labels for **true 1–2-word labels** (group headers, status chips) — never paragraphs (slow to read, wastes horizontal space). ([b13](https://b13.com/blog/designing-with-type-a-guide-to-ui-font-size-guidelines))
- **Group by proximity, not dividers** — dividers add noise in a small window.
- **Let the eye rest:** designate breathing areas (the detail hero, space around PLAY). Density is per-section. ([Designsystems.com](https://www.designsystems.com/space-grids-and-layouts/))
- **Hit targets ≥ 24×24 CSS px** even when visually compact — pad the click area beyond the glyph (WCAG 2.5.8). ([Microsoft](https://learn.microsoft.com/en-us/windows/apps/design/style/spacing))

---

## 4. Design Token System

Synthesized from Raycast (surface ladder, hairlines, white-CTA, type scale), Linear (LCH neutrals, inset borders, modal shadow), Vercel (neutral ramp), Material 3 (tonal elevation). Dark-only, compact, image-backed. Token names are stable across the three directions in §8 — only values swap.

### 4.1 Color (OKLCH where useful; hex fallbacks shown)

Use **OKLCH/LCH** to generate ramps so steps read perceptually even and hover/active stay consistent. ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui))

```css
/* Canvas & surfaces — darker→lighter = elevation (NOT shadows). Near-black canvas. */
--canvas:     #08090a;  /* oklch(0.16 0.004 250) — behind everything, mostly covered by image */
--surface-0:  #0d0e0f;  /* oklch(0.19 0.004 250) — content backdrop / nav rail base */
--surface-1:  #131415;  /* oklch(0.22 0.004 250) — cards, list rows */
--surface-2:  #1a1b1d;  /* oklch(0.26 0.005 250) — hover, raised card, inputs */
--surface-3:  #232427;  /* oklch(0.31 0.006 250) — active / pressed / deep card */

/* Glass over background.webp — fill carries contrast, blur carries aesthetic */
--glass-chrome: rgba(15,16,17,0.62);  /* blur 12px — title bar, nav rail */
--glass-panel:  rgba(15,16,17,0.80);  /* blur 16px — detail hero scrim / sheet */
--glass-spec:   inset 0 1px 0 rgba(255,255,255,0.12);  /* specular top edge (liquid-glass cue) */
--scrim-top:    linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.25) 30%, rgba(0,0,0,0.65));
--scrim-hero:   linear-gradient(to top, rgba(0,0,0,0.78), transparent 60%); /* hero text substrate */

/* Hairlines — depth comes from these, not shadow */
--line:        rgba(255,255,255,0.08);
--line-strong: rgba(255,255,255,0.16);
--line-inset:  inset 0 0 0 1px rgba(255,255,255,0.06);

/* Text — tiered off-white, never pure #fff for body */
--text-hi:    #f4f4f6;  /* headings / build title */
--text:       #d4d5d8;  /* default body */
--text-mute:  #9a9ca1;  /* secondary / meta / micro-labels */
--text-faint: #6a6c72;  /* disabled / group headers (with +tracking) */

/* Brand accent — ONE hue, desaturated (medium saturation, ~OKLCH chroma 0.13). */
/* Default = "Obsidian Forge" ember; swap per §8. */
--accent:       #ff7a3d;  /* oklch(0.72 0.17 45) — PLAY, progress fill, active nav, focus ring */
--accent-press: #e8652b;
--on-accent:    #1a0c04;

/* Semantic — STATUS ONLY, never button fills or decoration */
--ok:   #59d499;  --ok-soft:   rgba(89,212,153,0.14);  /* installed / ready */
--warn: #ffc533;  --warn-soft: rgba(255,197,51,0.14);  /* update available */
--err:  #ff6161;  --err-soft:  rgba(255,97,97,0.14);   /* failed */
--info: #57c1ff;  --info-soft: rgba(87,193,255,0.14);
```

Text-emphasis discipline (mirror Material's opacity tiers): high 87% / medium 60% / disabled 38% white — but prefer the named tiers above for predictable contrast. ([Material dark](https://m2.material.io/design/color/dark-theme.html))

### 4.2 Type scale (Inter Variable; Inter Display for hero title only)

Inter Variable = one file, all weights, small Electron bundle. Inter Display only for the build hero title. Keep wide-tracked uppercase micro-labels — a Raycast signature. ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui), [Raycast](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/raycast/DESIGN.md))

```
display   28 / 32  weight 600  tracking -0.02em   Inter Display   (build hero title)
h1        20 / 28  weight 600  tracking -0.01em                   (section headers)
h2        16 / 24  weight 590  tracking  0                        (card group / panel titles)
body      14 / 20  weight 400                                     (descriptions, prose)
body-med  14 / 20  weight 510                                     (default UI labels — heavier default)
caption   12 / 16  weight 400                                     (meta, secondary)
micro     11 / 16  weight 590  tracking +0.08em UPPERCASE         (group headers, status chips ONLY)
```
Tabular numerals for RAM / version / player counts / progress %.

### 4.3 Spacing, radii

```
--s-2:2  --s-4:4  --s-8:8  --s-12:12  --s-16:16  --s-24:24  --s-32:32
gutter 16 · card pad 12 · grid gap 12 · titlebar 36 · row heights 56/64/72 · hero pad 24–32

--r-xs:4   --r-sm:6 (buttons/inputs/nav)   --r-md:8   --r-lg:12 (cards/sheet)   --r-full:9999 (pills/avatars)
```

### 4.4 Elevation (surface ladder + hairlines; shadow only for true overlays)

```
e0 flat:   --surface-0 + 1px --line
e1 card:   --surface-1 + 1px --line  (+ --line-inset highlight optional)
e2 hover:  --surface-2 + 1px --line-strong
e3 active: --surface-3 + 1px --line-strong
overlay (routed sheet / dropdown / toast): --glass-panel + blur(16px)
           + box-shadow 0 16px 48px rgba(0,0,0,0.55) + --glass-spec
```
In dark UI, **elevation = lighter surface, not shadow**. Reserve the one big soft shadow for the single thing that truly floats (a dropdown/sheet/toast). ([Uxcel](https://uxcel.com/blog/mastering-elevation-for-dark-ui-a-comprehensive-guide-342), [Linear tokens](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1))

### 4.5 Background image + glassmorphism (the legibility recipe)

Layer order, bottom→top: `background.webp` → **global scrim** (`--scrim-top` + radial vignette) → **near-opaque content surfaces** (cards/panels) → **glass chrome** (title bar, rail) → **overlay** (sheet/toast with shadow).

Non-negotiables:
- **Pre-darken the background** with the global scrim so glass always has a calm substrate regardless of which `background.webp` ships.
- **Cards do NOT use backdrop-blur** — they sit on `--surface-1`. Real glass is confined to title bar + nav rail + detail hero scrim (~2–3 blurred surfaces max on screen). ([NN/g](https://www.nngroup.com/articles/glassmorphism/), [Axess Lab](https://axesslab.com/glassmorphism-meets-accessibility-can-frosted-glass-be-inclusive/))
- **Blur 12–16px** for chrome/panels (8px reads out-of-focus, >20px = fog + GPU cost). Never animate backdrop-blur. Promote glass panels to their own layer (`will-change: transform`). ([figr](https://figr.design/blog/glassmorphism-0e8b1), [dev.to costly CSS](https://dev.to/leduc1901/costly-css-properties-and-how-to-optimize-them-3bmd))
- Every glass text panel carries its contrast via the **fill**, not the blur; the **hero** uses `--scrim-hero` so the title + PLAY always sit on a dark gradient. Add `--glass-spec` top highlight to glass chrome + PLAY for the cheap "liquid glass" cue. ([Apple Liquid Glass](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/))
- Honor `prefers-reduced-transparency` → swap glass for opaque `--surface-2` (accessibility + perf).

---

## 5. Component-by-Component Guidance

### 5.1 Title bar (frameless, 36px)
- **Use Window Controls Overlay**: `titleBarStyle: 'hidden'` + `titleBarOverlay: { color, symbolColor, height: 36 }`. This gives native-correct min/max/close (correct icons, hover, RTL, accessibility) for free and auto-handles the Windows-right / macOS-left split. Lay your content out with `env(titlebar-area-*)` and reflow on `geometrychange`. ([Electron custom title bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar), [MDN WCO](https://developer.mozilla.org/en-US/docs/Web/API/Window_Controls_Overlay_API))
- Whole bar `-webkit-app-region: drag`; every interactive child (search, updater badge, any chip) `no-drag`. `user-select:none`. Preserve double-click-to-maximize; keep grabbable empty space. Don't debug "drag broke" while DevTools is open. ([Electron frameless](http://beta.electronjs.org/docs/latest/tutorial/window-customization/))
- Layout (Windows; mirror for macOS): `[ drag + small wordmark ] … [ global search (no-drag) ] [ auto-updater badge (no-drag) ] [ NATIVE controls ]`.
- **Dim the bar/brand on window blur** (inactive) — native apps do this; its absence is an uncanny tell.

### 5.2 Home / build grid + build tile
- **Home:** Continue hero (last-played, big PLAY) + horizontal recently-played strip (sorted last-played, reflow by width). Compact horizontal cards: image + 1-line title + 1 micro-label (loader/version). Don't stack 5 metadata rows.
- **Catalog grid:** two collapsible groups, grid/list toggle, single search spanning both. Strict uniform gutters (inconsistent spacing is the #1 amateur tell). ([Justinmind](https://www.justinmind.com/ui-design/game))
- **Build tile** (`--surface-1`, `--r-lg`): 16:9 build hero/icon as the visual identity (Prism proves icons carry the library); title `body-med`; one meta row (`caption --text-mute`); a **status chip** (Installed `--ok-soft` / Update `--warn-soft` / New / not-installed). Hover → `--surface-2` + `--line-strong` + a quick **Play affordance** reveal (Steam's hover-Play). `motion-safe:hover:scale-[1.02]`; inner hero `scale-[1.04]` in `overflow-hidden` (subtle Ken Burns); `active:scale-[0.99]`. ([Battle.net density](https://wccftech.com/battle-net-update-biggest-in-years-layout-accessibility/))
- Push RAM/loader/version detail to the detail page — keep cards minimal.

### 5.3 Build detail (routed page)
- **Full-bleed hero** = that build's own key art (not the global background) so builds feel distinct, with `--scrim-hero` bottom gradient. Title overlaid bottom-left in `display`; **PLAY as the only primary CTA in the hero**. ([Riot/Battle.net cinematic per-item](https://www.riotgames.com/en/news/new-riot-client-coming-soon))
- **Sticky hero header** on scroll → PLAY + title stay pinned (Modrinth). A **version/server selector sits right beside PLAY** (the Mojang Play anatomy), not behind a Settings trip. ([Modrinth](https://modrinth.com/news/changelog), [Minecraft launcher wiki](https://minecraft.wiki/w/Minecraft_Launcher))
- Body tabs (icon+label): **About · Media · Servers · Settings**. Consider a **bento sub-grid** under the hero (About | Servers | Media compartments) to pack varied content into 624px without deep scroll. ([DesignerUp bento heroes](https://designerup.co/blog/2024-design-trends-5-must-try-hero-layouts/))
- **Settings tab:** RAM + loader as **inline-editable tiles** with a pen affordance + icon controls — not buried in a dialog. Export / Duplicate / Delete live in a **three-dot overflow**. One entry point, no Edit-vs-Settings ambiguity. ([Carbon #399](https://github.com/gorilla-devs/GDLauncher-Carbon/issues/399))
- **Servers** = the right-rail-equivalent content, on the build's own page (avoids Epic's detached pop-out). Keep server list collapsible. ([ResetEra](https://www.resetera.com/threads/the-epic-games-launcher-is-poorly-designed-and-is-a-major-turn-off.96514/))

### 5.4 Create flow (My Builds)
- Linear, **one-primary-CTA-per-step** (matches first-run setup register): name + icon/hero → MC version → loader → RAM. Big single button each step.
- Use Java Manager defaults so users never wrangle JDKs (Carbon first-class Java Manager). ([Carbon vs](https://gdlauncher.com/docs/gdlauncher-vs-gdlauncher-carbon/))
- **Premium touch:** a **share-code** that recreates a local build on another machine — distinctive, low cost, makes "My Builds" feel premium. ([Carbon share code](https://gdlauncher.com/docs/gdlauncher-vs-gdlauncher-carbon/))

### 5.5 PLAY / install button — state machine + progress

| State | Label | Visual | Interaction |
|---|---|---|---|
| `not-installed` | **Install** | accent fill, download icon | click → confirm if >150MB → `installing` |
| `queued` | **Queued** | muted + position | passive |
| `installing` | **Installing… 64%** | button *becomes* the progress bar (fill = progress) + Pause/Cancel | primary disabled; progress only |
| `update-available` | **Update** | accent fill, distinct icon + small badge | click → `updating` |
| `verifying` | **Verifying…** | loading state, overall bar creeps | passive |
| `ready` | **Play** | brightest element on screen, ≥44px target | click → `launching` |
| `launching` | **Launching…** | inline spinner, disabled | auto-advances |
| `running` | **Running / Stop** | muted secondary + dot | optional Stop / focus-game |
| `error` | **Retry** | error-tinted, error icon | click → retry from failed phase; "Details" → Console |

Rules: one primary only; **disable during transitions** to prevent double-launch; **never disable silently** — if blocked (no Java, corrupt install) show inline reason + alternate (Install/Repair); **progress-as-button** is the compact-window winner; `ready → Play` is the single brightest element; **do not auto-launch** after install. Implement as a `BuildStatus` discriminated union / XState reducer; the button is a pure render. ([Riot dynamic CTA](https://www.riotgames.com/en/news/new-riot-client-coming-soon), [NN/g states](https://www.nngroup.com/articles/button-states-communicate-interaction/), [Android](https://developer.android.com/guide/playcore/feature-delivery/ux-guidelines))

**Progress UX (the centerpiece):**
- **Determinate by default** (installs have known bytes); indeterminate only for manifest-resolve/verify-before-count.
- Multi-phase: one **weighted overall bar** + a changing **phase label** (`Downloading mods · 142/350` → `Verifying…` → `Installing…`). If a sub-phase is uncountable, switch the *secondary* indicator to indeterminate while the overall bar keeps a slow forward creep — never look frozen.
- Detail line: `64% · 412 MB / 1.2 GB · 8.4 MB/s · ~2 min` with **smoothed** speed/ETA (3–5s rolling avg) so numbers don't jitter.
- **Never go backwards** (retry holds the bar, changes label to "Retrying…"). **Stall ≥10s** → "Connection slow — still trying…" + keep an alive indeterminate accent. **Accelerate near 100%**, then a brief completion beat (check + flash), then advance to `ready`.
- **Pause / Cancel** adjacent; Cancel confirms if significant bytes downloaded; downloads run in **background** so the user keeps browsing. `>150MB` → consent before download.
- Show the **same progress** on the catalog card and the open detail, from one state source. Persistent slim status in the detail hero; **bottom download strip** (~32px, expands into the queue) for global view (Steam model). ([Page Flows](https://pageflows.com/resources/progress-bar-ux/), [UX Planet](https://uxplanet.org/progress-bar-design-best-practices-526f4d0a3c30), [Mobbin](https://mobbin.com/glossary/progress-indicator), [Steam](https://store.steampowered.com/libraryupdate))

### 5.6 Empty / loading / error states
- **Loading thresholds:** <300ms show nothing · 300ms–1s busy-button · >1s **skeleton cards** matching real dimensions (perceived 30–50% faster than spinners) · ≥10s determinate progress. Skeleton the detail hero + stub the description/server lines. Spinners only for sub-second self-contained actions. ([CroTricks](https://crotricks.com/loading-skeleton-ux/), [Onething](https://www.onething.design/post/skeleton-screens-vs-loading-spinners))
- **Empty My Builds:** illustration + "No builds yet" + one line + **two CTAs** (primary "Browse Official" = fast path to a working game; secondary "Create build"). Don't render an empty labeled section — auto-hide and show the prompt. ([Steam auto-hide](https://store.steampowered.com/libraryupdate), [NN/g empty states](https://www.nngroup.com/articles/empty-state-interface-design/))
- **No search results** (≠ zero-data): keep the search bar, "No builds match 'X'", "Clear filters".
- **Empty server list:** "No servers configured · Add server".
- **Error states by severity:** field-level → inline red helper + border (e.g. invalid RAM); transient → toast with Retry; blocking (offline first-run, install failed) → persistent banner with *why* + next step + link to Console. ([Android](https://developer.android.com/guide/playcore/feature-delivery/ux-guidelines))

### 5.7 Skin viewer (3D)
- Treat as a **breathing area** — generous space, dark calm substrate, subtle idle rotation behind `motion-safe:` (vestibular-safe; no large auto-pan). Pause render when off-screen/unfocused (EA "no heavy background work" lesson). ([EA forums](https://forums.ea.com/discussions/ea-app-feedback-en/ea-app-vs-origin---who-did-it-better/12348530))
- Place it where it earns the space (a profile/skin panel), not crammed into the catalog. Keyboard-rotatable with visible focus.

### 5.8 Toasts / notifications
- Info/success **auto-dismiss 3–5s**; **errors persist** until dismissed + carry an action (Retry / View log). One app-wide position (bottom-right, below the title bar). One at a time — queue, don't stack many.
- On dark glass: tinted left border by type (green/amber/red/blue) + icon + title + optional action.
- A11y: `role="status"` / `aria-live="polite"` for info; `role="alert"` / `aria-live="assertive"` for errors. Must not obscure focused interactive content (WCAG 2.4.11).
- Wire to the PLAY FSM: `→ ready` fires success toast "Build ready to play" + Play action; `→ error` fires persistent toast + Retry + View log. The **auto-updater badge** is a persistent non-dismissing notification (accent dot + "Update ready") — never auto-dismiss. ([Canva toasts](https://www.canva.dev/docs/apps/design-guidelines/toasts/), [LogRocket](https://blog.logrocket.com/ux-design/toast-notifications/), [toast a11y](https://blog.greeden.me/en/2026/03/02/the-complete-accessibility-guide-to-toast-notifications-alerts-and-banners-screen-readers-focus-non-disappearing-design-history-and-error-priority-wcag-2-1-aa/))

### 5.9 Console (separate window)
- Keep monospaced, high-contrast, dark; it's the destination for error "Details" links and the Repair/log path. Auto-scroll with a "pause/stick-to-bottom" toggle; copy-all + filter by level. It is the authoritative actionable-next-step surface for blocking errors (Android guidance).

---

## 6. Motion & Micro-interaction Spec

Small window = short distances → sit at the **fast end** of every range; **never exceed 250ms** for view transitions. ([M3 motion](https://m3.material.io/styles/motion/overview/how-it-works), [NN/g](https://www.nngroup.com/articles/animation-duration/))

```css
--ease-standard:   cubic-bezier(0.4, 0, 0.2, 1);   /* in+out at rest */
--ease-decelerate: cubic-bezier(0, 0, 0.2, 1);     /* ENTER (ease-out) */
--ease-accelerate: cubic-bezier(0.4, 0, 1, 1);     /* EXIT (ease-in) */
--ease-emphasized: cubic-bezier(0.2, 0, 0, 1);     /* expressive enter */
```

| Purpose | Duration | Easing |
|---|---|---|
| Hover / press / toggle | 100–150ms | decelerate / standard |
| Simple fade enter | 150ms | decelerate |
| Simple fade exit | 75–100ms | accelerate |
| Route/sheet enter (build detail) | 200ms | emphasized-decelerate |
| Route/sheet exit | 150ms | accelerate |
| Accordion expand / collapse | 250 / 200ms | standard |
| Hero cross-fade on build switch | 200ms | decelerate |
| Install progress sweep | continuous | linear (shimmer on filled portion only) |

The **asymmetry is load-bearing**: enter decelerates (responsive, eye settles), exit accelerates (gets out of the way). `linear` only for spinners/shimmer. Press = `active:scale-[0.98]`; state-label cross-fade 150ms.

**Reduced motion (non-negotiable, low-effort/high-impact):** all transforms/parallax/Ken-Burns behind `motion-safe:`; global backstop:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration:.01ms!important; transition-duration:.01ms!important; }
}
```
The **determinate progress fill stays informative** under reduced motion (it's data) — only the shimmer/indeterminate sweep is replaced by a static/slow-opacity pulse. Use Tailwind `motion-safe:` / `motion-reduce:`. ([CSS-Tricks](https://css-tricks.com/almanac/rules/m/media/prefers-reduced-motion/), [Epic Web](https://www.epicweb.dev/tips/motion-safe-and-motion-reduce-modifiers))

---

## 7. Accessibility Checklist

- **Contrast:** body ≥ 4.5:1; large text + UI components/icons ≥ 3:1; verify every gray pair against `--canvas`/`--surface-*` AND against the lightest region of `background.webp`. Don't invert a light theme — dark mode needs its own verified pairs (APCA perceives light-on-dark differently). ([W3C 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [WebAIM](https://webaim.org/articles/contrast/), [BOIA](https://www.boia.org/blog/offering-a-dark-mode-doesnt-satisfy-wcag-color-contrast-requirements))
- **Glass legibility:** never rely on blur for contrast — scrim fill carries it. ([Axess Lab](https://axesslab.com/glassmorphism-meets-accessibility-can-frosted-glass-be-inclusive/))
- **Catalog grid + segmented tabs: roving tabindex** (one `tabindex=0`, arrows move focus; Tab enters/leaves). Don't make every card a tab stop. ([W3C APG](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/))
- **Detail (if a sheet) / dialogs:** focus moves in (close or PLAY), **Tab trapped**, **Esc closes**, **focus returns** to originating card. (As a route, restore focus + scroll on back.)
- **`:focus-visible`, never `outline:none`** without replacement. Ring ≥2px, ≥3:1, with dark halo so it reads on any background:
  `box-shadow: 0 0 0 2px rgba(0,0,0,0.6), 0 0 0 4px rgba(255,255,255,0.9);` offset 2px. ([a11y-collective](https://www.a11y-collective.com/blog/focus-indicator/), [TestParty 2.4.11/Focus Appearance](https://testparty.ai/blog/wcag-focus-appearance-minimum))
- **Focus not obscured (WCAG 2.4.11):** focused cards must clear the sticky title bar → `.catalog { scroll-padding-top: 44px; }`; toasts must not cover focused interactive content. ([W3C 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum))
- **Hit targets ≥ 24×24 CSS px** (WCAG 2.5.8) — pad window-control glyphs and overflow buttons.
- **Never color alone** for state — pair status with icon/shape (Discord status-cue pattern); PLAY label changes text, not just color.
- **Disabled controls** carry `aria-disabled` + tooltip explaining why; **never a disabled primary with no explanation**.
- **Keyboard-operable** everything (Enter/Space); correct ARIA (`aria-pressed`, `aria-live`, tablist/tab/tabpanel for detail tabs).
- **Honor `prefers-reduced-motion` and `prefers-reduced-transparency`** (opaque fallback).

---

## 8. Three Candidate Design Directions

All three are **swappable token sets over one glass engine** (base + accent + contrast), so all can be prototyped cheaply (Badlion's multi-theme lesson). Only `--accent`/surface chroma/imagery weight change; structure, type, spacing, motion stay constant.

### Direction A — "Obsidian Forge" ⭐ RECOMMENDED
- **Mood:** Premium pro-tool with controlled gamer heat — Linear/Raycast discipline + Lunar's "luminous accent on dark." Confident, fast, slightly dangerous-cool.
- **Palette:** Near-black graphite base (low chroma, faintly warm), surfaces stepped by elevation over blurred `background.webp`. Signature accent **molten ember-orange** (`oklch(0.72 0.17 45)` ≈ `#ff7a3d`) — unmistakably Minecraft via netherite/lava, tasteful at medium saturation; secondary muted cyan `--info` for links. Off-white text.
- **Type:** Inter / Inter Display; tabular numerals for RAM/version/counts.
- **Imagery:** Big per-build hero art is the star; glass chrome floats over it. One voxel touchpoint: logo + a subtle block-edge bevel on the PLAY button only.
- **Motion:** Restrained — accent glow blooms on hover/active, hero cross-fade on build switch, install as a smooth accent sweep. No bouncy motion.
- **Pros:** Reads premium at our density; distinctive; obviously Minecraft; accent doubles as the install/play affordance.
- **Cons:** Ember must be policed — over-applied it tips toward "fire-themed gamer skin."

### Direction B — "Glass Biome"
- **Mood:** Raycast/2026 dark-glassmorphism turned up — alive, atmospheric, "Imagine a Place" warmth. The `background.webp` does heavy lifting; UI is layered translucent glass that lets biome color bleed through.
- **Palette:** Deep desaturated indigo/teal base so imagery tints the glass; **context-shifting accent** (emerald PLAY, indigo browse) — controlled nod to Discord status-cues + Modrinth's adaptive sidebar. Heavy blur, thin 1px light borders everywhere.
- **Type:** Inter for UI + a slightly warmer rounded-geometric display face for the wordmark/headers (friendliness).
- **Imagery:** Full-bleed background always visible; build hero becomes a secondary glass card. Most "alive" of the three.
- **Pros:** Genuinely differentiated; leverages the existing asset; premium without 3D overhead.
- **Cons:** Glass-over-busy-image is the biggest legibility risk at 1000×624 (needs disciplined scrims); heaviest Electron blur cost; a shifting accent fights the "one accent, one job" rule and the FSM PLAY clarity; risks looking generic-trendy if borders/contrast aren't perfect.

### Direction C — "Clean Slate"
- **Mood:** Feather/Modrinth/Linear — calm, fast, no-bloat. Structure carried by spacing, type, elevation; minimal color.
- **Palette:** Pure neutral graphite ramp, single acid-accent used sparingly (grass-lime `~#9be34a` or emerald to keep brand tie). Background.webp barely visible behind a near-opaque scrim; glass minimal.
- **Type:** Inter / Inter Display, tight vertical rhythm.
- **Imagery:** Hero art present but framed and quiet; catalog reads almost like a file list with thumbnails.
- **Pros:** Lowest risk of childish/cheap; fastest to build/maintain; ages well; best legibility at density.
- **Cons:** Least emotionally "gamer"; could feel corporate for a Minecraft audience; weakest differentiation from every other launcher chasing the Linear look; under-uses the background asset.

### Recommendation
**Ship Direction A ("Obsidian Forge") as default**, built on the token engine so **B and C are alternate themes**. Rationale: A sits exactly where the brand research points — pro-tool structure (keeps it premium at our density) with gamer energy confined to the accent + hero-imagery layer (keeps it from reading as B2B SaaS), and the single ember accent maps perfectly onto the PLAY-button state machine and progress fill. B's context-shifting accent and heavy blur undercut both the "one accent, one job" discipline and the 624px legibility budget; C under-uses the `background.webp` advantage we already have. Keep B/C as one-line theme swaps for users and for A/B testing. ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui), [Raycast](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/raycast/DESIGN.md), [Lunar](https://www.lunarclient.com/news/the-new-launcher-is-here), [Badlion 4.0](https://www.badlion.net/forum/thread/352866))

---

## Anti-patterns to avoid (consolidated)
- Toolbar-button density / separate per-instance management window (Prism/MultiMC). ([Prism 6.0](https://prismlauncher.org/news/release-6.0/))
- Duplicate Edit/Settings entries; Settings-detour-to-Overview (Carbon #399).
- Fixed resizing side rail / ad chrome eating the window (CurseForge). ([CF idea](https://curseforge-ideas.overwolf.com/ideas/CF-I-1528))
- Two nav items → same view (Epic); no library search (Epic); detached pop-out for core features (Epic). ([ResetEra](https://www.resetera.com/threads/the-epic-games-launcher-is-poorly-designed-and-is-a-major-turn-off.96514/))
- Icon-only nav with no labels AND no tooltips (Ubisoft 2.0). ([gHacks](https://www.ghacks.net/2023/06/27/ubisoft-connect-beta-brings-a-new-interface-for-the-launcher-and-more-features/))
- Blur behind text/buttons; >20px blur; animated backdrop-blur; >2–3 concurrent glass surfaces. ([NN/g](https://www.nngroup.com/articles/glassmorphism/))
- Disabled primary with no explanation; progress moving backwards; auto-launch after install; heavy background sync causing launch stutter (EA).
- Pixel fonts in chrome; flooding the UI with gradients/glow (Lunar over-vibrancy at our density).
- Pure `#000` content surfaces; pure `#fff` body text; saturated accents that vibrate on dark.

---

## Key sources
Minecraft launchers — [Modrinth changelog](https://modrinth.com/news/changelog) · [Modrinth app](https://modrinth.com/app) · [GDLauncher Carbon](https://github.com/gorilla-devs/GDLauncher-Carbon) · [Carbon #399](https://github.com/gorilla-devs/GDLauncher-Carbon/issues/399) · [Prism 6.0](https://prismlauncher.org/news/release-6.0/) · [Minecraft launcher wiki](https://minecraft.wiki/w/Minecraft_Launcher) · [CurseForge idea CF-I-1528](https://curseforge-ideas.overwolf.com/ideas/CF-I-1528) · [Lunar new launcher](https://www.lunarclient.com/news/the-new-launcher-is-here) · [Feather](https://feathermc.com/)
Major launchers — [Steam library](https://store.steampowered.com/libraryupdate) · [Battle.net](https://wccftech.com/battle-net-update-biggest-in-years-layout-accessibility/) · [Riot client](https://www.riotgames.com/en/news/new-riot-client-coming-soon) · [Epic critique (ResetEra)](https://www.resetera.com/threads/the-epic-games-launcher-is-poorly-designed-and-is-a-major-turn-off.96514/) · [Ubisoft Connect (gHacks)](https://www.ghacks.net/2023/06/27/ubisoft-connect-beta-brings-a-new-interface-for-the-launcher-and-more-features/) · [GOG Galaxy 2.0](https://techraptor.net/gaming/news/gog-galaxy-20-details-four-new-features-and-crazy-levels-of-customization)
Visual system — [Raycast DESIGN.md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/raycast/DESIGN.md) · [Linear redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) · [Linear tokens](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1) · [Material dark](https://m2.material.io/design/color/dark-theme.html) · [Uxcel elevation](https://uxcel.com/blog/mastering-elevation-for-dark-ui-a-comprehensive-guide-342) · [figr glass](https://figr.design/blog/glassmorphism-0e8b1) · [NN/g glassmorphism](https://www.nngroup.com/articles/glassmorphism/) · [Apple Liquid Glass](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)
Motion & states — [M3 motion](https://m3.material.io/styles/motion/overview/how-it-works) · [NN/g animation duration](https://www.nngroup.com/articles/animation-duration/) · [NN/g button states](https://www.nngroup.com/articles/button-states-communicate-interaction/) · [Android Play Core UX](https://developer.android.com/guide/playcore/feature-delivery/ux-guidelines) · [Page Flows progress](https://pageflows.com/resources/progress-bar-ux/) · [CSS-Tricks reduced-motion](https://css-tricks.com/almanac/rules/m/media/prefers-reduced-motion/)
Electron / a11y / density — [Electron custom title bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar) · [MDN Window Controls Overlay](https://developer.mozilla.org/en-US/docs/Web/API/Window_Controls_Overlay_API) · [Microsoft spacing](https://learn.microsoft.com/en-us/windows/apps/design/style/spacing) · [W3C contrast 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) · [W3C focus not obscured 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum) · [W3C APG keyboard](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) · [Smashing text over images](https://www.smashingmagazine.com/2023/08/designing-accessible-text-over-images-part1/)
Brand — [Linear brand](https://linear.app/brand) · [Discord branding](https://discord.com/branding) · [Badlion 4.0](https://www.badlion.net/forum/thread/352866) · [Minecraft logo history](https://looka.com/blog/minecraft-logo/) · [Accent colors for dark mode](https://seedflip.co/blog/accent-colors-dark-mode)
