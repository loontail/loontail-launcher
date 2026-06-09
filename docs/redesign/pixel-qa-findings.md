# Pixel-QA Punch-List — Loontail Launcher (1000×624)

Deduped, contradiction-resolved, priority-ordered. Highest visual impact first.
Already-fixed items, harness artifacts (no-network official cards, sparse vanilla test build),
and out-of-scope surfaces (Settings page, Login, modal-body internals, install FSM) are excluded.

## Summary

The catalog still leaks two different icon systems between grid and list views, and the
"Mine" badge changes weight between them — the most jarring cross-screen breaks. The Create
and Settings modals have a glass-surface problem: opaque `surface-2` fields, the loader
Segmented track, and the disabled primary button all collapse into the panel, so controls read
as flush slots and the disabled "Create" button shows no label at all. After that it is
type/figure consistency: the StatTile and Create field eyebrows use a different
weight+tracking than every other eyebrow, MC version numbers flip between tabular and
proportional figures across screens, and the modal mixes three control heights / two radii.
Lowest tier is hero/scrim polish.

## Fixes

### 1. [HIGH] Catalog icon tile differs between grid and list views
Grid footer renders a `BuildIcon` (lettered gradient "M"); the list row's 48px tile renders a
`BuildMedia slot="background"` (cropped screenshot). Same build → two different glyphs.
Standardize on `BuildIcon` (the canonical icon used by the detail hero + settings modal).
- File: `src/renderer/features/clients/components/BuildCard.tsx` (list variant, lines 43-50)
- Change: replace the `<div class="relative size-12 …"><BuildMedia …/></div>` block with
  `<BuildIcon item={item} className="size-12 shrink-0 rounded-md" />`.

### 2. [HIGH] Disabled "Create" button is a blank gray pill (no label visible)
`variant=default` is the white CTA; the global `disabled:opacity-50` fades the white fill AND
the dark label together, so the disabled button shows neither "+ Create" text nor icon
(confirmed in create-modal.png). Give the white CTA a dedicated, legible disabled treatment.
- File: `src/renderer/shared/ui/Button.tsx` (base line 40; `variantClasses.default` line 13)
- Change: drop the global `disabled:opacity-50`; add `disabled:opacity-50` to
  `secondary/destructive/outline/ghost`; for `default` add
  `disabled:bg-surface-2 disabled:text-text-faint disabled:opacity-100 disabled:shadow-none`.

### 3. [HIGH] "Mine" badge variant differs between grid and list
Grid = `variant="solid"` (filled dark pill); list = `variant="outline"` (hollow, `text-mute`),
which reads markedly weaker beside the solid "Ready" pill in the same list row. The list row
sits on an opaque surface, so use the surface-resident `soft` fill to match Ready's weight.
- File: `src/renderer/features/clients/components/BuildCard.tsx` (list line 55)
- Change: `<Badge variant="outline">` → `<Badge variant="soft">`.

### 4. [HIGH] Modal fields + loader Segmented collapse into the glass panel
On the translucent `glass` modal, opaque `bg-surface-2` (and `bg-surface-1/70` on the Segmented
track) sit at nearly the same value as the panel (~1.4:1), so fields look like flush slots and
the loader track has no visible recess — only the white "Vanilla" pill reads as a control.
- Files: `src/renderer/features/clients/components/CreateBuildModal.tsx` — `SELECT_CLASS`
  (line 22-23) and Name `Input` (line 121); loader `<Segmented>` (lines 144-153). Track default
  in `src/renderer/shared/ui/Segmented.tsx` (line 34). Same pattern in `BuildSettingsModal.tsx`.
- Change: lift field fills to `bg-surface-3` with `border-edge-md` (target ≥3:1 vs panel); pass
  the loader Segmented `className="w-full bg-surface-2 border-edge-md"` (or change the
  Segmented default track to opaque `bg-surface-1 border-edge-md`). Apply the same field lift
  in the Settings modal so the RAM input/folder field clear the panel.

### 5. [HIGH] Unify all uppercase microlabels on one eyebrow recipe
StatTile labels (`BuildOverview.tsx` line 15) and Create field labels (`CreateBuildModal.tsx`
line 27) use `font-semibold … tracking-wide` (~0.025em), while every other eyebrow app-wide
(`MY BUILDS`, `OFFICIAL`, `ABOUT`, `RECENT`, `CONTINUE PLAYING`) uses
`font-bold … tracking-eyebrow` (0.18em). They visibly differ in weight + ~7× tracking on the
same screen (StatTiles sit right above the `ABOUT` eyebrow).
- Files: `BuildOverview.tsx:15`, `CreateBuildModal.tsx:27`
- Change: `text-microlabel font-semibold uppercase tracking-wide text-text-mute` →
  `text-microlabel font-bold uppercase tracking-eyebrow text-text-mute` (both).

### 6. [MEDIUM] One figure policy for MC version numbers (tabular-nums)
The same version flips between tabular (Home hero, stat tiles) and proportional figures
(detail InfoChips, card meta, Settings RAM readout). Settings RAM jitters while dragging.
Pick tabular for all numeric build facts.
- Files / changes:
  - `BuildDetailPage.tsx:37` — InfoChip value `<span>{value}</span>` → `<span className="tabular-nums">{value}</span>`.
  - `BuildCard.tsx` meta (lines 53, 86) — wrap/version with `tabular-nums` (or accept proportional only on cards if version is folded into the dotted meta string).
  - Settings modal RAM value + min/max/free scale labels — add `tabular-nums`.

### 7. [MEDIUM] Standardize modal control heights and radii
In Create modal: Name Input + selects are `h-10 rounded-lg` (40px/16px), footer buttons are
`h-9 rounded-md` (36px/12px), loader Segmented is `h-8` (32px), and its track is `rounded-md`.
Three heights stacked + mismatched radii. Same height mismatch in the Builds toolbar (Input
`h-10` vs default Segmented ≈42px → toggle protrudes ~2px). Resolve the radius contradiction by
standardizing sibling interactive controls on **`rounded-lg`**.
- Files: `CreateBuildModal.tsx` (selects line 23, input 121, buttons 188/191, segmented 144);
  `BuildsHomePage.tsx` (Input 153 + Segmented 156-164); `Segmented.tsx` (track line 34, inner
  buttons 54).
- Change: render the footer buttons `h-10 rounded-lg`; render the loader/toolbar Segmented so
  its track resolves to exactly 40px (track `rounded-lg`, inner segments `h-8 p-1` netting 40px)
  and align top/bottom with the adjacent select/search box.

### 8. [MEDIUM] Stat tiles & detail action-row chips read as barely-there over the dark base
StatTiles use `bg-surface-1` on canvas (~0.06 L step) and the secondary chips use
`bg-surface-2/80` over a near-black hero (resolves well below 0.255 L), so both look almost
borderless next to the white Play CTA.
- Files: `BuildOverview.tsx:14` (StatTile); `Button.tsx:14-15` (`secondary` variant) consumed by
  the detail action row.
- Change: StatTile `bg-surface-1` → `bg-surface-2 border-edge-md`. For chips over the dark
  detail base drop the `/80` alpha (`bg-surface-2`) and bump to `border-edge-md` (alpha is only
  justified over art).

### 9. [MEDIUM] Home carousel chevron collides with the Play CTA
The left `CarouselButton` is pinned `left-3 top-1/2`; the action row is also vertically centered
starting at `px-12`, so the 40px chevron kisses Play's left edge at 1000×624 (a click-target
hazard). Lift the chevrons off the CTA band.
- Files: `HomePage.tsx` (CarouselButton, L44-64) and/or `HomeHero.tsx` (hero wrapper L37).
- Change: raise chevrons to `top-[40%]` (and `left-2`) so they ride the art band only, OR give
  the hero content block a `pl-16` min inset so Play clears the ~64px chevron zone.

### 10. [MEDIUM] Modal shell radius < inner element radius (inverted nesting)
Modal shell is `rounded-md` (12px) but inputs/selects and the header icon square are
`rounded-lg` (16px) — inner radius exceeds the shell. Bump the shell so it is ≥ inner radii.
- File: `src/renderer/shared/ui/Modal.tsx` (line 120)
- Change: `rounded-md` → `rounded-lg`.

### 11. [LOW] Align the Input primitive to app tokens (drop stale shadcn defaults)
`Input.tsx` ships `rounded-sm h-9 text-sm border-input bg-background` + a `ring-offset` focus
ring that contradicts the app's `ring-2 ring-ring/60` (no offset) standard, forcing every call
site to override. Align the primitive and remove redundant overrides.
- File: `src/renderer/shared/ui/Input.tsx` (lines 12-17)
- Change: `h-10 rounded-lg border border-edge bg-surface-2 text-body` +
  `focus-visible:ring-2 focus-visible:ring-ring/60` (drop `ring-offset-*`). Then drop the now-
  redundant `h-10 rounded-lg border-edge` overrides in CreateBuildModal/BuildsHomePage.

### 12. [LOW] Unify the primary-CTA focus ring across the two button systems
The install `ActionButton` focus ring is `ring-glass/70 ring-offset-2 ring-offset-overlay`; the
shared `Button` is `ring-2 ring-ring/60` (no offset). Same conceptual primary action, different
ring.
- File: `src/renderer/features/clients/components/install/ActionButton.tsx` (lines 37-38)
- Change: → `focus-visible:ring-2 focus-visible:ring-ring/60` (no offset), matching `Button.tsx`.

### 13. [LOW] Native `<select>` keeps the OS dropdown arrow
Both Create selects show the native gray arrow instead of a monochrome lucide `ChevronDown`.
- File: `CreateBuildModal.tsx` — `SELECT_CLASS` (line 23), selects (lines 127, 159)
- Change: add `appearance-none pr-9`; wrap each select in a relative container with
  `<ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-mute" />`, mirroring the search-icon pattern.

### 14. [LOW] Detail hero title reuses the 60px recipe at 36px
Home hero is `text-6xl font-black tracking-tight`; detail hero is `text-4xl font-black
tracking-tight`. Nunito Black + negative tracking that reads well at 60px over-tightens at 36px.
- File: `src/renderer/features/clients/components/BuildDetailHero.tsx` (line 43)
- Change: `font-black tracking-tight` → `font-extrabold` (relax tracking to default at 36px).

### 15. [LOW] Detail hero icon bottom-aligns and drops below the title stack
The hero row is `items-end`, so the 64px icon hugs the title baseline and leaves a gap beside
the badge row. Optically center it against the two-line title stack.
- File: `BuildDetailHero.tsx` (line 33)
- Change: `items-end` → `items-center`.

### 16. [LOW] RECENT filmstrip active-card indicator is too weak
Active = `ring-1 ring-text-hi`; inactive only `opacity-80` — the two cards read nearly equal,
yet this control drives the whole hero.
- File: `RecentFilmstrip.tsx` (lines 66-68)
- Change: active → `border-text-hi ring-2 ring-text-hi`; inactive → `opacity-60`.

### 17. [LOW] "Mine" filmstrip badge left edge misaligned with the title
Badge is `left-2` (8px) while the title is `inset-x-2.5` (10px) — a 2px stagger on every recent
card.
- File: `RecentFilmstrip.tsx` (line 79)
- Change: `absolute left-2 top-2` → `absolute left-2.5 top-2`.

### 18. [LOW] List-row horizontal padding asymmetry + ungrouped trailing badges
List variant `p-2.5 pr-4` gives 10px left vs 16px right; and `Mine`+`Ready` inherit the row's
14px gap so the related pills don't cohere. Also the 48px thumbnail's `rounded-md` (12px) is
rounder than the concentric target (~6px).
- File: `BuildCard.tsx` (button line 41; thumbnail line 43; badges lines 55-56)
- Change: `p-2.5 pr-4` → `p-2.5 pr-3.5`; wrap `{Mine}` + `<BuildStatusBadge/>` in
  `<div className="flex items-center gap-2 shrink-0">`; thumbnail `rounded-md` → `rounded`.

### 19. [LOW] Home vs detail action-row gap drift
Home action row is `gap-2.5` (10px), detail is `gap-3` (12px) — same components, 2px drift.
- File: `HomeHero.tsx` (line 64)
- Change: `gap-2.5` → `gap-3`.

### 20. [LOW] Catalog page gutter differs from detail/hero gutter
`BuildsHomePage` content uses `px-8` (32px); detail + heroes use `px-12` (48px) — left edge
jumps 16px on navigation. Pick one content gutter token.
- File: `BuildsHomePage.tsx` (line 142) vs `BuildDetailPage.tsx` (line 86)
- Change: align catalog outer padding to `px-12` (or vice-versa).

### 21. [LOW] Resolve `font-bold` vs token weight on size tokens
Modal `h2` and catalog `display` titles add `font-bold` (700) over size tokens that already
declare a weight (h2 = 600, display = 700). Decide whether 700 is intended and either retune
`--text-h2--font-weight` to 700 or drop the redundant `font-bold`.
- Files: `CreateBuildModal.tsx:100`, `BuildSettingsModal.tsx:37`, `BuildsHomePage.tsx:144`

### 22. [LOW] Optional: drop redundant version/loader InfoChips on detail
The action-row `Gamepad2 1.8.7` / `Package Vanilla` chips repeat the first two Overview
StatTiles within ~80px. Consider removing the two InfoChips (keep Play + gear) so the action row
stays light. Optional — verify against intended density before applying.
- File: `BuildDetailPage.tsx` (InfoChip L23-39, usage L98-99) vs `BuildOverview.tsx` (L66-67)
