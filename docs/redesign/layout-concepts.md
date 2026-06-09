# Loontail Launcher — Layout Concept Library

A divergent set of **layout / arrangement** reworks for the 1000×624 frameless launcher. The
visual style is **locked**: pure monochrome black & white, dark frosted-glass chrome (restored
glassmorphism + white-gradient glass fills + specular top highlight + hairline rim), a single
near-white solid **PLAY** CTA as the only bright element, and **build key-art is the only
color** (Official builds' Minecraft logos), framed by monochrome chrome. These concepts only
rework **how elements are arranged**, never the palette.

Hard constraints every concept honors:
- **624px tall is the scarce axis.** 36px title bar → 588px content. Budget the vertical first.
- **My Builds have no key-art** (flat graphite tiles today) → any stage/hero must have a
  first-class monochrome fallback (initials + loader/version typeset large + seeded graphite
  gradient/voxel-noise), not a black void.
- **Official key-art is the only color** and must NOT be demoted to icon-size thumbnails.
- **Glass budget:** max ~2 always-on blurred surfaces + 1 transient; the scrolling catalog grid
  is **never** glass (opaque surface ladder).
- **PLAY is the single brightest element**, runs the full FSM (Install → Queued → Installing% →
  Update → Verifying → Play → Launching → Running → Retry) with progress rendering inside it.
- ≥24px hit targets; keyboard-navigable; honor `prefers-reduced-transparency` / `-motion`; no
  motion >250ms.

All px sizes below are at **1000×624**.

---

## How the candidate field was reduced

The ideation produced 15 concepts; four were literally the same "Command Deck" (master-detail
list + Ctrl-K) re-pitched, and several immersive concepts (Cover-Flow Dock, Marquee, Forge
Table, Spotlight Split) collapse onto two real poles: a **full-bleed immersive stage** and a
**persistent master-detail pane**. The library below is the **deduped, fix-folded** set of nine
mutually-distinct layouts, ranked by usability + distinctness + fit. The top of the ranking is
the recommended mock-up set.

Spectrum coverage (so the set is genuinely divergent, not nine dashboards):

| Pole | Concept(s) |
|---|---|
| Conservative / lowest-risk | Dashboard Deck |
| Storefront / image-forward | Atrium Gallery, Marquee Stage |
| Master-detail / power-tool | Command Deck, Spotlight Split |
| Single-surface / no routes | Forge Bench (cockpit), Marquee Stage |
| Exploit the wide aspect | Rail Deck (filmstrip) |
| Keyboard-first | Spotlight (command-first), Command Deck |
| IDE / dockable | Workbench (Pro mode) |

---

## 1. Command Deck ⭐ — master-detail control panel that can breathe into a hero

**One-liner:** A persistent dense build-list on the left drives a detail pane on the right that
never routes; the list collapses to an icon rail on demand so a build's key-art can bloom to
full storefront scale.

**Why it wins:** Kills both documented failures by construction (the list is always populated,
a build is always staged → no empty Home, no floating-PLAY void) and adds best-in-class
multi-install monitoring, while the collapse-to-spotlight move resolves its own worst weakness
(cramped key-art) without a second screen.

**Layout spec (1000×624):**
- **Title bar** 36px full-width glass (always-on blur #1): wordmark left, updater badge +
  native window controls right. No search here.
- **Left list column** ~272px, full height below title (588px), glass (always-on blur #2):
  search field at top (focus with `/`), then sticky groups — `CONTINUE/RECENT` (last-played +
  2–3 recents), `MY BUILDS` (leading `+ Create` row, dense rows: 24px thumb + title + status
  glyph + 2px bottom progress fill on install), `OFFICIAL` (richer rows). Roving-tabindex.
  A **list/grid toggle** in the column header.
- **Right detail pane** ~712px wide. Hero band **~230px** = build key-art (My Builds → mono
  fallback) with `--scrim-hero`; title (bottom-left), then a **44px opaque toolbar BELOW the
  art** carrying the near-white PLAY (brightest element, progress-as-fill) + version/loader
  selector + 3-dot overflow. Below: a horizontal tab strip (About · Media · Servers · Settings,
  ~40px) and the panel fills the remaining ~274px, scrolling inside the pane only. **Opaque
  surfaces** (no blur) — they sit over the build's own dark-scrimmed art.
- **Spotlight expand:** clicking a "expand" affordance (or auto on a never-installed Official
  build) slides the list to a **64px icon rail**, letting hero + Media gallery bloom to ~900px.
- **Download tray:** transient glass strip expanding upward from the list column's bottom edge.

**Signature moves:**
- List-as-navigation: arrow the list, the right pane cross-fades in place (≤200ms), no route.
- Per-row 2px progress fills → monitor several installs while reading another build.
- Spotlight slider: dense working mode ↔ art-forward storefront mode on one surface.
- Two-zone focus contract (Tab between list and pane; `/` focuses search from anywhere).

**Folded-in fixes:** opaque hero/toolbar/tabs (only title bar + list blur = 2 always-on);
single search (in the list, not the title bar); Console stays a separate window (never the pane);
Settings-in-pane visibly **deselects** the list; first-run auto-selects a featured Official
build + shows `Create your first build`; list trimmed 300→272px; Esc priority stack documented
(palette > tray > toast > collapse-spotlight).

**Scores:** usability 8 · distinctness 7 · feasibility 6 · fit 7

```
+------------------------------------------------------------------------------+
| (o) LOONTAIL LAUNCHER                                  (•update)  _  []  x    | 36 titlebar (glass)
+----------------------+-------------------------------------------------------+
| [ search…        / ] |  ███████ BUILD KEY-ART (staged) ███████  ░scrim░      |
| CONTINUE             |  ██  MINECRAFT NETWORK TESTING                     ██  | hero ~230
|  ▣ Net Testing   ●   |  ██████████████████████████████████████████████████  |
|  ▣ Test Build    ✓   | [ ▶ PLAY  ████ ]  [ MC 26.1.2 · Fabric ▾ ]   ( … )    | 44 toolbar (opaque)
| ──────────────────── +-------------------------------------------------------+
| MY BUILDS        [▾] | [About]  Media   Servers   Settings                   | 40 tabs
|  + Create build      | ─────────────────────────────────────────────────────|
|  ▣ Minecraft ●▓▓ 64% | About                                                 |
|  ▣ Test Build    ✓   | This build bundles the Loontail network mod and a     | panel ~274
| OFFICIAL         [▾] | curated server list for testing…                      | (scrolls)
|  ▣ TC2 (art)         |                                                       |
|  ▣ Test client (art) | Servers ▸   Media ▸                                   |
| ──────[ ⤓ 1 ]─────── |                                                       |
+----------------------+-------------------------------------------------------+
   272px list (glass)              712px detail pane (opaque)
```

---

## 2. Atrium Gallery — full-width storefront grid with a slide-up detail sheet

**One-liner:** No sidebar — a thin top nav reclaims the full 1000px for a large opaque key-art
grid, and detail rises as a glass sheet over the dimmed gallery (with prev/next + capped hero)
so you never lose your browsing place.

**Why it wins:** The most image-forward layout that still respects the vertical budget; gives
Official key-art the largest catalog stage of any concept, and the nav-in-titlebar fix erases
its only structural flaw (a wasted top tab-bar).

**Layout spec (1000×624):**
- **Title bar** 36px glass (always-on blur #1) **hosts the nav**: wordmark + 3 inline text
  tabs (Home · Library · Downloads) left, Settings/Console icons + updater + window controls
  right. **No separate tab-bar row** (reclaims 40px).
- **Content** full 1000px wide, 588px tall, opaque (perf): a sticky toolbar (~40px) with a
  segmented `My Builds | Official | All` + one search + grid/list toggle; then the **gallery** —
  3–4-up large 16:9 key-art tiles. My Builds tiles use the mono fallback + a leading dashed
  `+ Create` tile; progress + status render on an **opaque sub-tile strip** below the art (never
  over the colored logo).
- **Detail sheet** = the single transient glass surface, slides up to cover ~88% (leaving the
  36px title bar live). Capped hero **~170px** key-art + sticky 44px header (title + PLAY +
  version/loader) + horizontal tabs + a small **prev/next chevron or filmstrip** of the current
  group along the sheet bottom so you compare neighbors without closing. Focus-trapped, Esc
  restores gallery scroll + focus.
- **Downloads:** ambient 28px bottom strip appears only when active; full queue lives in the
  Downloads tab.

**Signature moves:**
- Full-width grid: Official key-art at storefront scale, the launcher's color showcase.
- Detail as a slide-up sheet over a dimmed gallery, with neighbor-switch so browsing never breaks.
- Home = magazine: one capped Continue hero (~40%) + one well-sized recently-played carousel.
- Progress on opaque sub-tile strips → guaranteed contrast against any bright logo.

**Folded-in fixes:** nav folded into the 36px title bar (kills the 40px tab-bar regression);
one search only; sheet hero capped + neighbor-switcher added; ambient download strip restored;
sheet renders opaque during the ≤250ms transit, blur on settle; reduced-transparency → opaque
sheet, reduced-motion → 1-frame fade.

**Scores:** usability 7 · distinctness 8 · feasibility 6 · fit 8

```
+------------------------------------------------------------------------------+
| (o) LOONTAIL   Home  Library  Downloads(1)        (•) [console][⚙]  _ [] x    | 36 titlebar = nav
+------------------------------------------------------------------------------+
| [ My Builds | Official | All ]   [ search ]                    [ grid | list ]| 40 toolbar
|                                                                              |
|  +---------------+  +---------------+  +---------------+  +---------------+   |
|  |   + CREATE    |  |//KEY-ART TC2//|  |//KEY-ART TC //|  |//KEY-ART TC3//|   | gallery
|  | (mono tile)   |  | Net Testing   |  | Test client   |  | Test client 3 |   | (opaque,
|  |───────────────|  |──── ✓ READY ──|  |──── ⤓ GET ────|  |──── ⤓ GET ────|   |  3-4 up,
|  +---------------+  +---------------+  +---------------+  +---------------+   |  scrolls)
|  +---------------+  +---------------+  +---------------+  +---------------+   |
|  |//KEY-ART//    |  |//KEY-ART//    |  |//KEY-ART//    |  |//KEY-ART//    |   |
+------------------------------------------------------------------------------+
   ↑ click a tile → glass SHEET slides UP over a dimmed gallery:
   ┌──────────────────────────────────────────────────────────────────────┐
   │ ░ KEY-ART hero (capped ~170px) ░   ◀ prev / next ▶                     │
   │ [ ▶ PLAY ]  [ MC 26.1.2 · Fabric ▾ ]            About Media Servers ⚙  │
   └──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Atrium Spotlight — persistent opaque spotlight pane + scrolling library list

**One-liner:** The build you're looking at is always the left ~40% of the screen (an opaque,
glass-free spotlight with hero + PLAY + tabs), while the right ~60% is a quiet vertical library
list with sticky group headers — launch context never disappears.

**Why it wins:** Master-detail that solves empty-Home, but distinct from Command Deck by being
**vertical-list-on-the-right + fixed spotlight-on-the-left** (not a left list driving a right
pane), and it commits the premium glass-over-key-art treatment to the spotlight hero where the
user actually looks.

**Layout spec (1000×624):**
- **Title bar** 36px glass (always-on blur #1): wordmark + search + updater + controls.
- **Spotlight pane** ~380px wide, full height (588px), **opaque** `--surface-2` (kept blur-free
  to stay in budget and bulletproof text): compact hero band **~150px** key-art (mono fallback
  for My Builds) with PLAY + version/loader **overlaid on the hero** (one row, not stacked);
  then About/Media/Servers/Settings tabs whose panel is the **single** scroll region below.
- **Library column** ~600px, full height, opaque, vertical **list** (not a grid): sticky headers
  `CONTINUE/RECENT`, `MY BUILDS` (leading `+ Create` row), `OFFICIAL` (wider key-art thumb rows).
  Selection (click / arrow) drives the spotlight; **hover does NOT** (no preview thrash). A
  row-level Play affordance on hover for one-click relaunch without the cross-screen trip.
- **Wide content** (Media gallery / long Servers) opens a transient glass sheet over **both**
  columns (the one transient blur), not just the right strip.
- **Download strip:** 32px at the library column's bottom, expands into a queue.

**Signature moves:**
- Permanently-populated opaque spotlight — the staged build is always half the screen.
- Vertical list with sticky headers scales to large catalogs far better than a carousel.
- PLAY + hero never leave the spotlight even while scrolling the catalog.
- Wide media/servers slide over the whole window, never covering PLAY mid-read.

**Folded-in fixes:** spotlight is **opaque** (only title bar + transient sheet blur); preview
follows **commit, not hover** (kills thrash + PLAY-target ambiguity); version+loader collapse to
one row beside PLAY; first-run/empty = a designed "Welcome / pick a build" spotlight state;
Home either differs structurally (recents strip layout) or is dropped from nav; transient sheet
widened to full window.

**Scores:** usability 7 · distinctness 7 · feasibility 6 · fit 7

```
+------------------------------------------------------------------------------+
| (o) LOONTAIL  [ search…                 ]            (•update)  _  []  x       | 36 titlebar (glass)
+-----------------------------------+------------------------------------------+
|   ░ HERO KEY-ART (~150px) ░        |  CONTINUE / RECENT                       |
|   MINECRAFT NETWORK TESTING        |  ▣ Net Testing   MC26.1.2·Fabric  ✓READY |
|   [ ▶ PLAY ]  [ MC26.1.2·Fabric ▾ ]|  ▣ Test Build    MC26.1.2·Fabric  ✓READY |
|  ──────────────────────────────────| ──────────────────────────────────────── |
|  ( About ) Media  Servers  ⚙       |  MY BUILDS                               |
|  ┌────────────────────────────────┐|  [ + ] Create build                     |
|  │ description text for the build…│|  ▣ Minecraft    MC1.20.4·Forge  ⤓INSTALL |
|  │ (single scroll region)         │| ──────────────────────────────────────── |
|  │                                │|  OFFICIAL                               |
|  │                                │|  ▣▣ TC2          curated · key-art       |
|  └────────────────────────────────┘|  ▣▣ Test client  curated · key-art ──[⤓1]|
+-----------------------------------+------------------------------------------+
   ~380px spotlight (opaque)            ~600px library list (opaque)
```

---

## 4. Dashboard Deck — rail + compact Continue + uniform grid + command palette (SAFE)

**One-liner:** The conservative, lowest-risk baseline: keep the proven 60px rail + routed
detail, but fix the empty Home with a compact Continue strip and fix flatness with one featured
Official row above a uniform 3-up grid, plus a Cmd/Ctrl-K palette for keyboard speed.

**Why it's in the set:** Every divergent set needs a floor. This is the most buildable, reuses
the frozen IA/components, and directly kills the two empty-screen complaints with structure
rather than risk.

**Layout spec (1000×624):**
- **Title bar** 36px glass: wordmark + centered Cmd/Ctrl-K search-pill + updater + controls.
- **Left rail** 60px glass (always-on): Home / Builds / (bottom) Settings / Console; active =
  brightness lift + hairline indicator.
- **Home:** a **compact ~110px Continue strip** (last-played key-art card + big PLAY + a small
  recents avatar row), then a **single featured Official row** (one 2-up cinematic tile) above a
  **uniform opaque 3-up grid** (My Builds with `+ Create`, then Official). NO 220px rotating
  hero (cut). One vertical scroll axis; no nested horizontal shelves.
- **Builds:** the same uniform 3-up grid full-height, segmented `My Builds | Official | All` +
  search; grid/list toggle.
- **Detail = routed `/builds/:id`** with sticky hero header (title + PLAY + version/loader pinned
  on scroll) and **tabbed** About/Media/Servers/Settings (no 4-cell bento at this width; optional
  2-pane About+meta only). Back restores scroll + focus.
- **Download strip:** 32px window-pinned, expands to queue.

**Signature moves:**
- Compact collapsible Continue strip (not a marquee) → Home is populated, not dominated.
- One featured 2-up row + uniform 3-up grid → size contrast without ragged masonry.
- Cmd/Ctrl-K palette as a keyboard accelerator (not the nav spine).
- Single primary PLAY; per-tile Play is a translucent secondary, never a second near-white CTA.

**Folded-in fixes:** rotating featured band killed; bento masonry replaced with uniform 3-up +
one featured row; detail is tabbed not bento; rail is the only scope owner (Home/Builds distinct
routes, no duplicate "Home" segment); one near-white PLAY enforced; download strip window-pinned.

**Scores:** usability 8 · distinctness 4 · feasibility 9 · fit 8

```
+------------------------------------------------------------------------------+
| (o) LOONTAIL        [  ⌘K  search or run…  ]              (•update)  _ [] x    | 36 titlebar
+----+-------------------------------------------------------------------------+
| ⌂  |  ┌ CONTINUE ───────────────────────────────────────────────────────┐   |
| Hm |  │ ░ Net Testing key-art ░   MINECRAFT NETWORK   [ ▶ PLAY ]  ⦿⦿⦿    │   | ~110
| ▦  |  └──────────────────────────────────────────────────────────────────┘   |
| Bd |  ┌ FEATURED (2-up Official) ─────────────┐  MY BUILDS                    |
|    |  │ //// KEY-ART  Test client 3 ////      │  ┌──────┐ ┌──────┐ ┌──────┐  |
|    |  └───────────────────────────────────────┘  │ [+]  │ │ ▣Mc  │ │ ▣Net │  | uniform
| ⚙  |  OFFICIAL                                    │Create│ │1.20  │ │26.1  │  | 3-up grid
| >_ |  ┌──────┐ ┌──────┐ ┌──────┐                  └──────┘ └──────┘ └──────┘  |
|    |  │ ▣TC2 │ │ ▣TC  │ │ ▣TC3 │                              ───────[ ⤓1 ]── | 32 strip
+----+-------------------------------------------------------------------------+
   60 rail              detail opens as routed /builds/:id (sticky hero + tabs)
```

---

## 5. Forge Bench — single-surface bento cockpit (master-detail in place)

**One-liner:** A modular bento dashboard whose largest tile is a live "Bench" that is both the
Continue hero and the build detail; surrounding tiles (Recently played, Official spotlight,
Library peek, Downloads) fill the old dead space — plus a minimal rail keeps Console/Settings
discoverable.

**Why it's distinct:** No routes; detail happens by the Bench tile morphing in place. Downloads
is a permanent first-class tile, not a hidden strip. It reads as a 2025 cockpit, not a
rail+pages launcher.

**Layout spec (1000×624):**
- **Title bar** 36px glass: wordmark + a visible search field (`/` accelerator) + a segmented
  `Dashboard | All Builds` view control + updater + controls.
- **Minimal rail** 44px glass (always-on, restores the two orphaned globals): Home glyph,
  Console, Settings. (Fix vs. the all-command-bar original.)
- **Content** 940×588 bento, **opaque tiles** (glass only on title bar + Bench scrim):
  - **Bench tile** ~58% width, full height — Continue hero by default (key-art / mono fallback +
    PLAY pinned header + version/loader); on selecting any build it shows the same tile as
    **detail** (tab strip About/Media/Servers/Settings scrolling inside). A visible
    back/collapse chevron + a title-bar breadcrumb (`Dashboard` / `Enigma · Detail`).
  - **Right column** fixed **3-tile max** with locked min-heights: `Recently played` (1 row,
    h-scroll), a shared `Official spotlight / Library peek` compartment, and a `Downloads` tile
    (collapses to a 1-line strip when idle).
- **Catalog macro-state:** the `All Builds` view flips the bento — Bench shrinks to a preview,
  right region becomes a 3-up grid with sticky `MY BUILDS` / `OFFICIAL` headers; selecting a
  card opens the **glass detail sheet** over the grid (keeps full-size color key-art).

**Signature moves:**
- Master-detail without routing: Continue/detail are the same morphing Bench tile.
- Downloads is a permanent dashboard tile (install activity is first-class, always visible).
- Bench Play pill carries a tiny build avatar so a swap is never ambiguous mid-install.
- Bento reflows between Dashboard ↔ Catalog by re-spanning the same tiles.

**Folded-in fixes:** keep a minimal rail for Console/Settings (don't delete nav); search is a
**visible** field + segmented control, `/` is the accelerator; in catalog mode color key-art is
NOT shrunk to a strip — selecting opens a glass sheet over full-size cards; PLAY + download state
pinned to the selected build with an avatar; breadcrumb + back chevron (never Esc-only); 250ms
morph prototyped as a kill-criterion (fallback: glass-sheet detail).

**Scores:** usability 6 · distinctness 9 · feasibility 5 · fit 6

```
+------------------------------------------------------------------------------+
| (o) LOONTAIL  [ / search builds… ]      (•)   [ Dashboard | All Builds ] _[]x | 36 titlebar
+--+---------------------------------------------------------------------------+
|⌂ | ┌ BENCH (Continue / selected) ───────────┐  ┌ RECENTLY PLAYED ─────────┐  |
|  | │ ░ key-art hero (build identity) ░       │  │ [img]Net Testing  2h     │  |
|>_| │ ENIGMA   MC26.1.2·Fabric  [ ▾ ]         │  │ [img]Test Build   yest   │  |
|  | │ ( ▶ PLAY )      ← single bright CTA     │  └──────────────────────────┘  |
|⚙ | │ About | Media | Servers | Settings      │  ┌ OFFICIAL SPOTLIGHT ──────┐  |
|  | │ desc scrolls inside the tile…           │  │ [ vivid key-art logo ]   │  |
|  | │                                         │  │ Net Testing   Explore >  │  |
|  | └─────────────────────────────────────────┘  └──────────────────────────┘  |
|  |                                               ┌ DOWNLOADS  Enigma 64% ◢ ┐  |
|  |                                               │ 412MB/1.2GB · 8.4MB/s   │  |
+--+---------------------------------------------------------------------------+
  44 rail        ~58% Bench (opaque, glass scrim)        right column (3 tiles)
```

---

## 6. Marquee Stage — immersive full-bleed stage + recents dock + catalog drawer

**One-liner:** A AAA-storefront feel: one full-bleed build-art stage with a fixed text-plate
carrying title + PLAY, a persistent bottom recents/downloads dock, and the full catalog summoned
as a single slide-up drawer — chrome floats over art rather than framing tiles.

**Why it's in the set:** The immersive pole — the boldest, truest fit for "key-art is the only
color." Distinct from Atrium Gallery (which is grid-forward) by being a single-build cinematic
resting state.

**Layout spec (1000×624):**
- **Title bar** 36px glass: wordmark + search/library affordance + **visible** Settings/Console
  icons + updater + controls.
- **Stage** ~940×456 full-bleed selected key-art (cross-fade ≤200ms on switch). For My Builds →
  the **procedural mono fallback stage** (first-class, not a footnote). A fixed **text-plate**
  bottom-left: translucent graphite glass panel (hairline + specular) carrying title + version +
  "last played 2h" + PLAY (FSM, brightest element). The plate **expands upward in place** into
  the tabbed detail panel (one deepening surface) — the dock hides + collapses to a 32px
  download strip while detail is open, reclaiming height for Media/Servers.
- **Dock** ~96px bottom glass (always-on): horizontal recently-played mini-cards + a pinned lane
  for top builds + a persistent **Library** button + a live download chip + an `All builds (14)`
  count so the catalog's existence/size is always visible.
- **Catalog drawer** = the one transient glass surface, slides up to ~80% over a dimmed stage:
  search + `MY BUILDS` (with `+ Create`) + `OFFICIAL` grids; select sets the stage + slides down.

**Signature moves:**
- Full-bleed key-art stage with a cross-fade identity swap (color confined to art).
- Fixed glass text-plate guarantees 4.5:1 regardless of the art behind it.
- Hero deepens into detail on the same surface (plate grows up) — no second screen.
- Bottom dock fuses recents + downloads + a permanent Library entry.

**Folded-in fixes:** procedural My-Builds fallback is a hard requirement; catalog opens instantly
(visible Library button + hotkey, reduced-motion = no animation); legibility scrim becomes a
fixed text-plate, not a full-width gradient; never stack drawer + sheet (one transient invariant;
dock collapses to a 32px strip when detail is open so Media/Servers get real height); Settings/
Console stay visible in the title bar; strict gesture/z-stack contract.

**Scores:** usability 5 · distinctness 9 · feasibility 5 · fit 7

```
+------------------------------------------------------------------------------+
| (o) LOONTAIL   [ search / library ]            (•)  [console][⚙]  _  []  x     | 36 titlebar
+------------------------------------------------------------------------------+
|                                                                              |
|        F U L L - B L E E D   B U I L D   K E Y - A R T   (the color)          |  stage ~456
|                                                                              |
|   ┌ glass text-plate ───────────────────────────┐                            |
|   │ ENIGMA   MC26.1.2·Fabric   last played 2h    │                            |
|   │ ( ▶ PLAY )   ( More ▾ → plate grows up )      │                           |
|   └───────────────────────────────────────────────┘ ....scrim................|
+------------------------------------------------------------------------------+
| DOCK [#Enigma][#Test][#Net]…  [Library ^]  All builds(14) | DL Enigma 64% ==  | 96 dock
+------------------------------------------------------------------------------+
   (Library ^ → CATALOG DRAWER slides up over dimmed stage: search + My Builds + Official grids)
```

---

## 7. Rail Deck — landscape filmstrip Home / cover-flow library

**One-liner:** Exploit that the window is wider than it is tall: the catalog is a single
horizontal filmstrip of **landscape** key-art cards (focused card slightly enlarged), with a
bottom dock PLAY that follows focus and a grid fallback for large libraries.

**Why it's in the set:** The only concept that treats the library as a 1D filmstrip exploiting
the wide aspect; folding Home into the filmstrip's pre-parked last-played focus is an elegant
idea worth showing even if scoped to the Home shelf.

**Layout spec (1000×624):**
- **Title bar** 36px glass: wordmark + search pill + updater + controls.
- **Filmstrip stage** ~1000×540: a horizontal row of **landscape (16:9) cards**, focused card
  ~1.15× (NOT 1.6×) so 5–6 builds stay legible; landscape frames fit the real wide key-art with
  no letterboxing. Each unfocused card shows a **status chip (icon+shape)** + a one-line
  version/loader caption (status is answerable across the strip). Neighbors step down in
  brightness (mono depth cue, CSS-only, no per-keypress filter animation). Two tracks (My Builds
  / Official) via a visible segmented switch in the dock.
- **Detail:** Enter blooms the focused card to a ~70% hero with an About+PLAY peek in a right
  column; a `More` affordance promotes to a **full-width routed/sheet** detail (reusing the built
  tab components) for Media/Servers/Settings, which the narrow bloom can't host.
- **Bottom dock** 48px glass: a pinned `+` Create chip + shelf switch + the **brightest PLAY**
  for the focused build (collapses to a progress chip during install) + a thin scrubber/minimap.
- **Grid fallback** toggle for many builds / reduced-motion (the dense accessible mode).

**Signature moves:**
- Landscape cover-flow: focus by scale + brightness (mono), not color; fits wide key-art.
- Home IS the filmstrip with last-played pre-parked focus — no empty Home by construction.
- Dock PLAY follows focus and morphs into the global download chip during installs.
- Scrubber/minimap drag flings across dozens of builds in one gesture.

**Folded-in fixes:** posters made **landscape** + focus reduced to 1.15× (recover grid scan
speed, fit real art); detail decoupled — bloom for a peek, full route/sheet for galleries;
critical status on **unfocused** cards via icon+shape chips; nav model collapsed to one primary
gesture + a visible segmented switch; depth cue CSS-only + reduced-motion → focus ring not a
dead strip; Create pinned + distinctly shaped; single PLAY source at a time; grid-view fallback.

**Scores:** usability 5 · distinctness 9 · feasibility 5 · fit 6

```
+------------------------------------------------------------------------------+
| (o) LOONTAIL          [  search builds…              ]      (•)   _  []  x     | 36 titlebar
+------------------------------------------------------------------------------+
|   .-----------.   .===================.   .-----------.   .---------.         |
|   | dim (mono)|   ||  ░ CONTINUE ░    ||   | Official  |   | Official|  …bleed |
|   | Test Build|   ||  [ KEY-ART 16:9 ]||   |  key-art  |   | key-art |  >      | strip ~540
|   |  ✓ READY  |   ||  MINECRAFT NET   ||   |  TC2  ⤓   |   | TC   ⤓  |         |
|   | 26.1·Fabr |   ||  MC26.1·Fabric ✓ ||   '-----------'   '---------'         |
|   '-----------'   '===== focused 1.15× '                                      |
+------------------------------------------------------------------------------+
| [+] [ My Builds | Official ] 7 |  ▶▶  P L A Y (brightest)  ◀◀  | |==o====| ⤓   | 48 dock
+------------------------------------------------------------------------------+
   create + shelf switch            state-machine PLAY follows focus    scrubber
```

---

## 8. Spotlight — command-first single screen (keyboard-first master-detail)

**One-liner:** A Raycast/Spotlight model: one always-live command bar drives a left results
list and a right live-preview pane; typing is the primary navigation, verbs (`>play`, `create`,
`official`) replace the rail, and blank query == a Continue/Recent Home — with a full-width glass
hero restored so it doesn't read as a flat IDE.

**Why it's in the set:** The keyboard-first pole — fastest intent-to-play. Distinct from Command
Deck by centering a **command bar + verbs** rather than a list+arrow model, and from everything
else by making typing the nav.

**Layout spec (1000×624):**
- **Title bar** 36px glass: wordmark + window controls + a persistent **utility chip cluster**
  (Create · Official · Settings · Console — so globals are never invisible-until-typed).
- **Command bar** 44px glass full-width: always-focused caret; ghost placeholder chips
  (`Try: >play  create  official  settings`); `/` or `>` opens a verb autocomplete dropdown.
- **Master-detail body** ~556px tall: **left results list** ~320px (groups `CONTINUE/RECENT`,
  `MY BUILDS` with `+ Create`, `OFFICIAL`; rows = thumb + title + version/loader + status glyph;
  roving tabindex). **Right preview pane** ~680px: a **full-width glass hero band** (key-art +
  scrim + specular — the restored glass moment, not opaque) with a wide PLAY CTA + version/loader
  selector, then horizontal tabs whose panel scrolls in-pane.
- **Focus contract:** caret always focused; ↑/↓ = list select; Enter = SELECT (repaint), never
  auto-play; a dedicated always-visible PLAY (or Ctrl+Enter) plays (Enter never overloaded); Tab
  → tab strip → panel; Esc → command bar.
- **Status strip** 32px: live download summary + a single expander (keyboard hints move to a
  focus-contextual micro-line). Download tray expands without covering PLAY.

**Signature moves:**
- Always-live command bar + verb prefixes replace the nav rail (keyboard speed).
- Co-visible master-detail: arrow the list, the preview repaints in real time, no route.
- Blank query == Home (distinct CONTINUE header) flips to live search on one keystroke.
- The preview hero is a real glass surface (frosted scrim + specular) so it stays warm.

**Folded-in fixes:** split rebalanced 320/680 with a full-width glass hero (key-art not a corner
stamp); persistent utility chips for Create/Official/Settings/Console; verb-teaching ghost chips +
autocomplete; strict documented focus contract (Enter never plays); a distinct Home state, not
just empty-string; glass spent on the preview hero (scrolling list stays opaque); status strip
slimmed to one job.

**Scores:** usability 6 · distinctness 9 · feasibility 6 · fit 5

```
+------------------------------------------------------------------------------+
| (o) LOONTAIL   [Create][Official][⚙][>_]                       (•)  _  []  x   | 36 titlebar
+------------------------------------------------------------------------------+
| ( > type to search builds, or a command…                              )       | 44 command bar
+--------------------------+---------------------------------------------------+
| CONTINUE / RECENT        |  ░░░ GLASS KEY-ART HERO BAND (full width) ░░░ PLAY▶|
| > ▣ Net Testing   ✓RDY   |   MINECRAFT NETWORK            MC26.1.2 / Fabric ▾ |
|   ▣ Test Build    ✓RDY   |  ──────────────────────────────────────────────── |
| MY BUILDS                |  [ About ]  Media   Servers   Settings             |
|   + Create new build     |  ──────────────────────────────────────────────── |
|   ▣ Minecraft     ⤓GET   |  A curated build for the Loontail network. Prose   |
| OFFICIAL                 |  scrolls inside the pane; hero + PLAY stay pinned.  |
|   ▣ TC2           DL 64% |  servers / media / RAM+loader tiles …             |
+--------------------------+---------------------------------------------------+
| v 412MB/1.2GB · 8.4MB/s · ~2m   |  Enter Select · Ctrl+Enter Play · / Search   | 32 strip
+--------------------------+---------------------------------------------------+
   ~320px list (opaque)              ~680px preview (glass hero + opaque body)
```

---

## 9. Workbench — IDE dockable workspace (experimental "Pro mode")

**One-liner:** A VS Code-style shell — activity rail + a toggleable catalog-tree side panel +
a summonable bottom dock (Downloads + Console as tabs) + a conditional thin status strip — for
the power-user minority who live in logs and juggle many builds.

**Why it's in the set:** The IDE pole and the only concept that makes Console persistent
in-window. Kept explicitly as a **behind-the-default Pro mode / experimental theme**, not the
casual default — but it is genuinely divergent and harvests three good ideas (Console-in-dock,
Ctrl-P quick-open, conditional download strip).

**Layout spec (1000×624):**
- **Title bar** 36px glass: wordmark + Ctrl-P quick-open + updater + controls.
- **Activity rail** 44px glass (always-on): Home / Builds / Search / Downloads / Console /
  Settings.
- **Side panel** ~220px, **default collapsed**; when open shows the catalog **tree** (`MY BUILDS`
  with `+ New build`, `OFFICIAL`; rows = chip + name + version + status glyph; hover/focus
  reveals a ≥24px Play/Install ghost button; right-click = Duplicate/Export/Delete). Opaque under
  reduced-transparency.
- **Main editor area:** detail with a **banded ~100px hero** + a single 44px toolbar (PLAY +
  version/loader) + tabbed About/Media/Servers/Settings filling the rest. **No editor tabs**
  (cut). Clicking the `Builds` node fills the main area with a real **key-art grid** (the
  storefront / first-run default) — color art is not demoted to tree chips.
- **Bottom dock** ~140px, **default closed**, transient: Downloads (default tab) + Console;
  **overlays** the content (does not push) so the hero keeps height. Opaque fallback.
- **Status strip:** conditional 18px, shown only when a download/verify is active (no always-on
  22px band).

**Signature moves:**
- Console is first-class and in-window (a summonable dock tab), not a separate window.
- Catalog tree + right-click context menus + Ctrl-P quick-open = real power-user ergonomics.
- A real Official key-art grid in the main area is the discovery/first-run default.
- Everything dockable: side panel + bottom dock summon on demand for a near-full-width editor.

**Folded-in fixes:** editor tabs killed; always-on status bar → conditional thin strip; dock
default-closed + capped 140px + **overlays** content; hover-Play ghost on tree rows; Official gets
a storefront grid (not tree chips); Console demoted to a dock tab (Downloads is the default);
hero capped + PLAY/version in one toolbar; enforce title-bar + side-panel = the 2 always-on,
dock = the 1 transient.

**Scores:** usability 4 · distinctness 9 · feasibility 4 · fit 4

```
+------------------------------------------------------------------------------+
| (o) LOONTAIL     [ quick open: build…  Ctrl-P ]            (•update) _  []  x  | 36 titlebar
+--+----------------------+---------------------------------------------------+
|H | BUILDS           [x] | ░░ banded KEY-ART hero (~100px) ░░  ENIGMA          |
|B | v MY BUILDS          | [ ▶ PLAY ]  [ MC26.1.2 · Fabric ▾ ]      ( … )       | 44 toolbar
|S |   + New build  ▶hover | About | Media | Servers | Settings                  |
|D |   ▣ Minecraft   ⤓     |  Description text………………………………                       |
|C | v OFFICIAL           |  ………………………………………………………                            | main editor
|⚙ |   ▣ TC2  (key-art) ✓ |                                                     | (grid when
|  |   ▣ Test client  ⤓   | ┌ DOWNLOADS | CONSOLE ───────────────[ ^ dock ]──┐  |  Builds node)
|  |                      | │ Enigma  Installing 64% ====----  [pause][cancel]│  | 140 dock
+--+----------------------+--└──────────────────────────────────────────────┘──+
|  Downloads: 1 active 64%                                          (conditional)| 18 strip
+------------------------------------------------------------------------------+
  44 rail   220 side panel (collapsible)        main editor + summonable dock
```

---

## Recommended mock-up set (ranked)

Mock up these in order; they cover the full divergence spectrum with no two alike:

1. **Command Deck** — master-detail that breathes into a hero (best usability+distinctness+fit).
2. **Atrium Gallery** — full-width storefront grid + slide-up sheet (image-forward pole).
3. **Atrium Spotlight** — fixed opaque spotlight + vertical library list (master-detail, list-on-right).
4. **Dashboard Deck** — rail + compact Continue + uniform grid (the safe baseline / floor).
5. **Forge Bench** — single-surface bento cockpit (no-routes pole).
6. **Marquee Stage** — immersive full-bleed stage + dock + drawer (cinematic pole).
7. **Rail Deck** — landscape filmstrip exploiting the wide aspect (1D pole).
8. **Spotlight (command-first)** — keyboard-first command bar + master-detail.
9. **Workbench** — IDE dockable Pro mode (experimental, behind the default).

Drop to 6 if time-boxed: 1, 2, 3, 4, 5, 6 (covers master-detail, storefront-grid, spotlight,
safe-baseline, cockpit, immersive — the six most build-worthy and mutually distinct).
```
