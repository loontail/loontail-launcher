# Redesign QA findings — Direction C (immersive monochrome)

## Summary

The "Direction C" redesign lands the intended shape: an immersive Home/detail with full-bleed key-art, a solid Builds catalog, and a monochrome surface ladder with white-only CTAs. The system is mostly coherent, but three classes of real problems remain. (1) **Token/contrast correctness**: `text-text-faint` (oklch 0.556) is used for small uppercase labels across the detail stat tiles, info chips, and Create fields, where it fails 4.5:1 on the opaque surfaces themselves; the immersive Home meta line also drops below floor because it sits in the scrim dead-zone. (2) **Design-system fragmentation**: two CTA token families, three focus-ring recipes, an off-ladder radius scale (`rounded-xl`/`2xl` not in `@theme`), a legacy `text-glass/40` eyebrow still live on the in-scope Screenshots tab, and the white CTA re-implemented three ways. (3) **Detail redundancy + a11y gaps**: MC-version/loader is shown twice within one viewport via mismatched-height controls, the Home carousel/filmstrip has no keyboard/SR model, and detail tablist arrows never move focus. None of these are blocking, but the contrast and detail-duplication items are visible in the shipped screenshots and should be fixed before sign-off.

Findings below are deduped and pruned against the deliberate adaptation rules (real data only, real loaders, monochrome status, no icon-picker) and the out-of-scope list (Settings, Login, client-settings internals, install FSM). Two critic findings were dropped/downgraded: the "two brand/alpha chrome treatments coexist" claim is **invalid** — `TitleBar` only renders on the login/setup path and never mounts alongside `TopNav` (see `App.tsx:31-35`); and the no-mod-count / chromatic-official-fallback concerns were reconciled with the rules below.

## Must-fix

### 1. Promote `text-text-faint` labels to `text-text-mute` (contrast: fails 4.5:1 on opaque surfaces)
`--color-text-faint` (oklch 0.556) measures ~3.79:1 over `surface-1` and ~3.5:1 over `surface-2` — below the 4.5:1 small-text floor. It is applied to small UPPERCASE label text on opaque chrome (not key-art glare), so it fails outright. `text-text-mute` (oklch 0.708) measures ~6.9:1 over `surface-1` and passes.
- Change to `text-text-mute`:
  - `src/renderer/features/clients/components/BuildOverview.tsx:15` (StatTile label — the dimmest text in `build-detail.png`)
  - `src/renderer/features/clients/components/BuildDetailPage.tsx:35` (InfoChip label)
  - `src/renderer/features/clients/components/CreateBuildModal.tsx:27` (Field label)
  - `src/renderer/features/clients/components/BuildsHomePage.tsx:129` (`curatedBy` aside)
- Keep `text-text-faint` only for genuinely decorative text (or retire/retune the token if nothing legitimate consumes it after this pass). Grep `text-text-faint` and reclassify each label usage.

### 2. Stop showing MC-version + Loader twice on the detail viewport
The action-row `InfoChip`s for VERSION and LOADER (`BuildDetailPage.tsx:98-99`) duplicate the Overview's first two `StatTile`s (`BuildOverview.tsx:66-67`), both visible in the 624px viewport (confirmed in `build-detail.png`). Pick one home:
- **Preferred:** make the action-row chips compact single-line inline chips matching the Home hero meta style — `icon + "1.8.7"`, `icon + "Vanilla"` — and keep the Overview StatTiles as the single boxed presentation. This also fixes finding #3 (height mismatch) and #4 (half-empty row).
- Edit the `InfoChip` component at `BuildDetailPage.tsx:23-41` to render one line (drop the two-line `flex-col` label/value), or drop Minecraft+Loader from the StatTile grid and keep only the action-row chips.

### 3. Normalize the detail action-row item heights (chips overhang Play/gear)
`InfoChip` is `px-3.5 py-2` two-line (~46-48px) while `PlayButton`/gear are 44px (`h-11`/`size-11`), so the row is not baseline-aligned (visible in `build-detail.png`). If you keep tile-style chips, pin them to the same box: `BuildDetailPage.tsx:32` change `px-3.5 py-2` → `h-11 px-3.5 py-0` and add `justify-center` to the inner `flex-col`. If you adopt #2's single-line chips this resolves for free.

### 4. Fix the Home hero meta-line contrast (sits in the scrim dead-zone)
The meta row (`HomeHero.tsx:49-61`) lands on ~rgb(120-129) mid-bright art; `text-text` ≈ 2.3:1 and the `text-text-mute` icons ≈ 1.5:1 — both fail (visible in `home.png`). The left scrim has faded and the bottom scrim is too low to help at vertical center.
- Raise the left scrim midpoint: `HomeHero.tsx:33` change `via-canvas/55 to-canvas/10` → `via-canvas/70 to-canvas/30`.
- Bump the two meta icons from `text-text-mute` → `text-text` (`HomeHero.tsx:52,59`).
- Verify against the lightest key-art (sky) region, not the average.

### 5. Migrate the in-scope Screenshots-tab eyebrow off the legacy `text-glass/40`
`BuildGallery` (the live Screenshots tab) renders its heading via `BuildSection.tsx`'s local `SectionLabel`, styled `tracking-eyebrow text-glass/40` — so switching Overview→Screenshots visibly changes the eyebrow color/weight vs every other section (`text-text-mute font-bold`).
- Delete the local `SectionLabel` in `src/renderer/features/clients/components/BuildSection.tsx:3-7` and reuse a shared eyebrow (the `BuildOverview` `SectionLabel`, or a new `shared/ui/Eyebrow`). Target style: `text-microlabel font-bold uppercase tracking-eyebrow text-text-mute`.
- Affects `BuildGallery.tsx:16` and `BuildAbout` (both consume `BuildSection`).

### 6. Define the card/tile radii in `@theme` (or pull cards back onto the ladder)
`@theme` defines only `--radius-xs/sm/md/lg`; `rounded-xl`/`rounded-2xl` fall back to Tailwind stock values, putting the card-radius scale outside the design system.
- Either add `--radius-xl` (+ `--radius-2xl` if needed) to `src/renderer/index.css:90-93` and document them in `ui-guideline.md §4`, **or** pull `BuildCard.tsx:67`, `BuildOverview.tsx:14`, `CreateBuildModal.tsx:96`, `BuildDetailHero.tsx:36`, `EmptyBuildsState.tsx:16`, `HomePage.tsx:33` (and the `rounded-2xl` empty tiles) onto `rounded-lg`.
- While here: reconcile `ui-guideline.md §4` (claims `md = 0.875rem`) with `index.css` (`--radius-md: 0.75rem`).
- Also unify the **card family radius**: grid poster is `rounded-xl` (`BuildCard.tsx:67`), list row `rounded-lg` (`:41`), filmstrip `rounded-lg` (`RecentFilmstrip.tsx:35`). Pick one token for all key-art card surfaces (or document the poster's intentional difference).

### 7. Drop unconditional `backdrop-blur` from the shared `Badge` (leaks glass onto the catalog grid)
`Badge variant="solid"` (`Badge.tsx:17`) hardcodes `backdrop-blur-md` that is (a) ungated by `prefers-reduced-transparency` and (b) painted on every card in the scrolling Builds grid (`BuildCard.tsx:78-79`), the filmstrip (`RecentFilmstrip.tsx:50`), and `BuildStatusBadge.tsx:37` — violating the chrome-only / never-the-catalog-grid blur budget.
- Change `Badge.solid` to `border border-edge bg-overlay/70 text-text-hi` (no `backdrop-blur-md`). Bumping the fill `0.55 → 0.70` also strengthens contrast over bright seeded art (covers the art-dependent-contrast concern for the status pill + filmstrip title).
- If a frosted look is genuinely wanted on the 1-2 chrome instances (e.g. the detail-hero pill), apply the gated `glass` utility there explicitly instead of baking blur into the shared primitive.

### 8. Route every white CTA through `Button variant="default"`
The white CTA is hand-rolled three ways: `HomePage.tsx:37-43` (HomeEmptyState) and `EmptyBuildsState.tsx:24-39` use inline `bg-cta ... hover:bg-cta-hover` anchors, while `CreateBuildModal` and `ActionButton` use the variant. The inline copies drift (HomePage omits `active:bg-cta-press`; both use `focus-visible:ring-glass/50` vs the primitive's ring), so the main CTA renders a different focus ring depending on which empty state you hit.
- Replace both inline buttons with `<Button onClick={...}><Icon/>label</Button>` (add `className="rounded-md"` if the larger radius is wanted). Deletes ~2 long class strings and unifies hover/active/focus.
- Confirm `Button.default` and `ActionButton.primary` resolve to the same fill (see #9).

### 9. Collapse the two CTA token families into one
`Button.default` uses `bg-primary text-primary-foreground` while `ActionButton.primary`/`Segmented` active use `bg-cta text-on-cta`; identical today but two sources of truth, and `Button.default`'s hover even crosses families (`hover:bg-cta-hover` on a `bg-primary` base).
- Point `Button.default` (`Button.tsx:13`) at `bg-cta text-on-cta hover:bg-cta-hover active:bg-cta-press`, **or** alias `--color-primary`/`--color-primary-foreground` to `--color-cta`/`--color-on-cta` in `index.css`, so every white CTA shares one definition.

### 10. Standardize one focus-ring recipe
Three conventions coexist: the `Button` primitive uses `ring-ring ring-offset-2 ring-offset-background` (`Button.tsx:39`); most redesigned controls use `ring-2 ring-ring/60` (TopNav, Segmented, BuildCard, tabs, modals); the empty-state CTAs use `ring-glass/50` (`EmptyBuildsState.tsx:27,35`).
- Standardize on `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60` (no offset), and update the `Button` primitive + empty-state CTAs to match. Drop the `ring-offset-*` and `ring-glass/50` one-offs. The offset ring is also wrong over key-art (Home/detail Play sits on art, not the named surface), so dropping it fixes a faint/invisible halo there too.

### 11. Make the Home carousel/filmstrip keyboard- and SR-navigable
The featured build changes via chevrons, filmstrip cards, and hero swap, but none is exposed as a single-select control: each filmstrip card is its own Tab stop, selection mutates the hero with no announcement, `aria-current` is the wrong semantic for picker selection, and the chevrons have no keyboard equivalent.
- Model the filmstrip (`RecentFilmstrip.tsx`) as the carousel control: wrap in `role="radiogroup"` with `aria-label={t('home.recent')}`, give each card `role="radio" aria-checked={active}` (replacing `aria-current`), and make it a roving-tabindex group (reuse `RovingGroup`, or `tabIndex={active?0:-1}` + ArrowLeft/Right) — one Tab stop, arrows change the featured build (giving the chevrons a keyboard equivalent).
- Add a visually-hidden `aria-live="polite"` node near the hero that announces `active.presentation.title` when `safeIndex` changes (`HomePage.tsx`), or move focus to the hero `h1`/Play after selection.

### 12. Detail tablist arrows must move focus, not just selection
`onTabKeyDown` (`BuildDetailPage.tsx:62-73`) calls `setActive` but never focuses the new tab, so after one ArrowRight the user is stranded on a now-`tabIndex={-1}` button (APG automatic-activation requires select **and** focus).
- After computing `nextTab`, focus its button: `document.getElementById(\`${baseId}-tab-${nextTab}\`)?.focus()` (or keep refs), in addition to `setActive(nextTab)`.

### 13. Add `prefers-contrast` / `forced-colors` handling
`index.css` only handles `prefers-reduced-motion`. In Windows High Contrast / forced-colors the monochrome surface ladder (all hue 0, lightness-only) collapses and the alpha focus rings (`ring-ring/60`) can vanish — the highest-risk mode for a lightness-only design.
- Add a `@media (forced-colors: active)` block to `index.css:292`: solid `outline: 2px solid CanvasText` on `:focus-visible`, borders to `currentColor` so the surface ladder doesn't collapse, and verify status pills/badges stay distinguishable.
- Also gate the blur-dim brand affordance behind `@media (prefers-contrast: no-preference)` / `(prefers-reduced-transparency: no-preference)` so high-contrast users keep full opacity — and floor or remove the `opacity-50` blur-dim on the brand row (`TopNav.tsx:19`); brand/ALPHA text should not drop below contrast when the launcher is backgrounded (its common state behind Minecraft).
- Minor: add `motion-safe:` to the ungated `hover:scale-105` at `BuildOverview.tsx:118`.

### 14. Delete dead `BuildStatusChip.tsx`
`src/renderer/features/clients/components/BuildStatusChip.tsx` is imported nowhere (grep confirms only its own definition). It duplicates `BuildStatusBadge` with a different (`text-glass`) styling system — drift risk under the aggressive-dead-code rule. Delete it and any now-unused helpers it alone pulled in.

### 15. Extract the duplicated `useWindowFocused` hook
The `useState(() => document.hasFocus())` + focus/blur `useEffect` is duplicated verbatim in `TopNav.tsx:97-108` and `TitleBar.tsx:10-21`. Extract `useWindowFocused()` into `shared/lib/hooks` and consume it in both. (Note: these chrome components never mount simultaneously — `TitleBar` is login/setup-only — so this is a reuse cleanup, not a double-listener bug.)

## Nice-to-have

- **Hoist `loaderLabel`**: the identical `${t(\`clientSettings.loader.${loader}\`)}${loaderVersion ? \` ${loaderVersion}\` : ''}` derivation appears in `BuildDetailPage.tsx:51` and `BuildOverview.tsx:47`. Add `loaderLabelFor(item, t)` next to `primaryLoader`/`loaderVersionFor` in `features/catalog` and call it from both.
- **Shared `Eyebrow` primitive**: the eyebrow class string (and three near-identical `SectionLabel`/`SectionHeading` components) is repeated across HomeHero, RecentFilmstrip, BuildOverview, BuildsHomePage, BuildSection. Promote one `shared/ui/Eyebrow` (with an optional `aside` slot) and pick one muted color + one size (retune `--text-eyebrow` to 10px and use it, or drop the orphaned token).
- **Shared `EmptyState` shell**: the centered icon-tile pattern is hand-built three times with `size-16`/`size-14` drift (`HomePage` HomeEmptyState, `BuildsHomePage` noResults, `EmptyBuildsState`). A shared shell removes the drift.
- **Single-build Home affordance**: with `recent.length <= 1` the chevrons hide and the screen reads as a static splash (the test account's state, per `home.png`). Either surface a "Browse all builds" hero affordance or seed the featured set from the broader catalog so it doesn't present as a dead carousel.
- **`IconAction` icon prop typing**: `TopNav.tsx:68` types `icon: typeof Settings`; use the canonical `icon: LucideIcon` (already used in Badge/Segmented/BuildStatusBadge).
- **`Button` off-ladder type + glass**: `Button` `sizeClasses` use `text-sm`/`text-xs` instead of `text-body`/`text-caption`, and the `secondary` variant bakes in `backdrop-blur-sm` (rendered inside immersive/scrolling content). Swap to the type tokens and drop the blur (use opaque `bg-surface-2/` + border like Segmented/Badge soft).
- **Status badge label size**: `BuildStatusBadge` renders the install state at `text-microlabel` (10px) — the smallest type on the card despite being the primary state signal. Bump that specific badge to `text-caption` (12px) `py-1`.
- **`CarouselButton` uses a raw template-literal className** (`HomePage.tsx:61`) instead of `cn()` — switch to `cn(...)` to keep tailwind-merge dedup semantics (the documented repo gotcha).
- **Needless wrap + restating comments**: `HomePage.tsx:76` wraps a single child as `{<HomeSkeleton />}` (write `<HomeSkeleton />`); re-review added comments at `CreateBuildModal.tsx:83` and `BuildSettingsModal.tsx:12` against the why-only rule.
- **`Segmented` role/behavior**: announces `role="radiogroup"`/`radio` but every segment is its own Tab stop with no arrow roving — make it a true roving radiogroup (APG) or downgrade to `aria-pressed` toggle buttons.
- **Create dialog SR labelling**: reference the `<h2>` + subtitle via `aria-labelledby`/`aria-describedby` (extend `Modal` to forward them), and surface why Create is disabled (keep it enabled and validate via the existing `role="alert"`, or add an `aria-describedby` hint).
- **`Select` primitive**: promote `CreateBuildModal`'s `SELECT_CLASS` into a `shared/ui/Select` (owning the chevron + radius) so future dropdowns don't re-copy the string; align its `rounded-lg` with the dialog's other controls.
- **RecentFilmstrip label substrate**: strengthen the card scrim `from-overlay/90 via-overlay/20` → `from-overlay/95 via-overlay/45` so the title holds on bright frames (paired with #7's badge fill bump).
- **Builds toolbar spread**: `h1 mr-auto` + `max-w-xs` search leaves a wide empty band between title and controls (`BuildsHomePage.tsx:143-165`); widen search to `max-w-sm`/`max-w-md` or move search+segmented to their own left-aligned row so the toolbar reads as one unit.

## Out of scope / dropped (do not action)

- The "two coexisting brand/alpha chrome treatments" finding is **invalid**: `TitleBar` renders only on login/setup (`App.tsx:31-35`), never alongside `TopNav`. Its legacy `text-glass` styling is out-of-scope login chrome; left as-is beyond the shared-hook extraction (#15).
- Official cards rendering `BuildVisualFallback`'s hue gradient when network/media is absent: in the harness there is no network, so this is largely an artifact of the test environment, and the gradient is the designed real-key-art-absent fallback. If desired later, route official missing-media through the same seeded `localBackgroundFor` screenshot treatment as local builds — but this is a polish call, not a correctness bug, and is **not** required for sign-off.
- No fabricated mod counts/sizes, real loaders only (vanilla/forge/fabric), monochrome status, no Create icon-picker — all deliberate adaptation rules; not flagged.
