# Loontail Launcher — Glass + Gradient Directions (FINAL)

Re-skin of the kept "Obsidian Forge" information architecture (left icon nav-rail, Home
dashboard, routed build-detail, Play/install FSM, last-played) back into the user's
**glass + gradient + chromatic-status** design language — refined to 2025-26 best practice
and hardened against the five critique lenses (legibility, Electron paint perf,
premium-vs-gamer, reduced-transparency, reduced-motion).

This document supersedes the monochrome `design-spec.md` skin. It does **not** touch the IA,
the Settings page, or the Login page (they inherit the new tokens).

---

## How to read this

Three mutually-distinct directions, all built on **one stable token structure** (same
names, same `@theme` keys, same `glass` / `glass-panel` utilities) so components keep
building and a direction is a values-only swap. Pick one; the other two remain cheap theme
swaps.

- **Ember Forge** (RECOMMENDED) — warm netherite/graphite glass, one molten-ember CTA.
- **Tideglass** — cool slate-graphite glass, one cyan/teal CTA tuned to NOT collide with green key-art.
- **Aurora Noir** — deep neutral-indigo glass, one single-hue violet CTA, faint static aurora wash.

All three obey the same hard rules (see **Shared foundations** at the bottom).

---

## Critique fixes folded into every direction

These are baked into all three theme blocks and utility recipes, not optional:

**Legibility (verified against the composite, not the tint):** `background.webp` is a
BRIGHT day forest (p50 luminance ~0.40, p90 ~0.82, p99 ~0.95, max 1.0). Contrast is carried
by the FILL, verified against glass-over-the-lightest-pixel:
- Chrome glass fill raised to **0.70–0.74 alpha** (not the old 0.55) so text clears WCAG
  over a near-white sky pixel; floating overlays **0.84**, and **0.90** when an overlay can
  appear over un-scrimmed key-art (version dropdown, toast, media popover on the hero).
- **Status label text is neutral/light, the colored dot+icon carries the hue.** This fixes
  the measured `--err`-on-soft-chip failure (4.04:1) — a light label reads >8:1 regardless
  of chip, and the system still never relies on color alone.
- **`--text-mute` / `--text-faint` are never used on glass.** Inside `.glass`/`.glass-panel`
  they step up one tier (mute→`--text`, and group eyebrows bind to `--text-mute` minimum,
  never `--text-faint`). Faint is reserved for genuinely-disabled controls on opaque surfaces.
- **Focus ring is dark-outermost** so it survives the brightest art: a dark halo wraps a
  bright core. Documented as load-bearing — never collapse to a single accent ring (accent
  alone is ~1.8:1 on bright sky).
- **Dark on-accent text** on every saturated CTA (white-on-accent fails AA at these
  lightnesses). Locked with a `--color-on-cta` token + a "why" note.

**Performance (hard blur budget):** **2 always-on blurred surfaces** (title bar + nav rail)
+ **1 transient overlay** max. The build-detail sticky header, tab strip, back pill, and
metadata chips are **opaque** (`--surface-2` + inset specular) — they sit over the build's
own dark art where blur buys nothing. The hero key-art is a **scrollable** layer (not
`position:fixed` + live CSS `filter`); darkening is a flat scrim div, not a per-pixel
`brightness()`. Grain is baked **once** at the app root, not a per-surface `::before`. The
top-lit edge is an **inset box-shadow** (not a gradient `background-clip` border) on blurred
elements. No `mix-blend` and no animated `backdrop-filter` anywhere.

**Premium-not-gamer:** **one accent, one job** (Play / progress / active-nav / focus /
selection), ≤5% of pixels. CTA gradient is **single-hue, ≤8% L spread** (no multi-hue
rainbow sweep). Per-card hover is a **neutral lit-edge + elevation lift**, never a chromatic
glow ring (a colored ring around green/red key-art is the gamer tell). Any per-build sampled
accent is **chroma-clamped ≤0.10, hue-guarded ≥40° from the brand accent**, cached per build,
and falls back to neutral — never a context-shifting hue near the CTA. "Ready/installed" is a
quiet neutral resting state; saturated hue is spent only on the exceptional states
(Update / Error). Max **2 chromatic hues at rest per catalog view** (brand accent reserved
for action; one status hue per card).

**Reduced-transparency / reduced-motion:** glass → a dedicated **opaque near-black token**
(darker than `--surface-2`, so mute text still clears 4.5:1), keep specular + hairline + grain.
Aurora/sheen freeze; determinate progress-fill width survives (it's data).

---

## Shared foundations (identical across all three)

- **IA is frozen.** Title bar 36px + left nav-rail 60px + content; Home dashboard; routed
  `/builds/:id` with sticky hero header; Play/install FSM; last-played. Re-skin only.
- **Glass is chrome-only.** Title bar + nav rail (always-on) + one overlay/hero-scrim
  (transient). **Never** the scrolling catalog grid — cards are opaque on the surface ladder.
- **Stable token names.** `--color-canvas`, `--color-surface-0..3`, `--color-text-hi/text/mute/faint`,
  `--color-cta/cta-hover/cta-press/on-cta`, `--color-accent-soft/glow`,
  `--color-ok/warn/err/info` (+ `-soft`), `--color-glass-fill`, `--color-glass-fill-panel`,
  `--color-glass-fill-float`, `--color-glass-opaque`, the `--text-*` scale, the four
  `--ease-*` easings, `--tracking-eyebrow`, radii. Only VALUES change per direction.
- **Type:** Nunito (bundled 400/500/600/700) kept. Scale unchanged from the IA spec; tabular
  numerals on RAM/version/counts/progress; wide-tracked 11px uppercase eyebrows for group
  headers + status chip labels only; on-imagery titles get a text-shadow belt-and-suspenders
  with the scrim; body text never pure `#fff` (caps at `oklch 0.97`).
- **Spacing / radii / grid:** 4px base; 16px gutters; 12px card pad; 3-up catalog; row
  heights 56/64/72; radii xs4 / sm8 / md12 / lg16 / full.
- **Motion:** ≤250ms view transitions; animate transform + opacity only (never
  `backdrop-filter`/blur/`box-shadow`/width); four easings (enter decelerates, exit
  accelerates); one signature motion per surface; determinate progress = data.
- **A11y:** body ≥4.5:1 / UI ≥3:1 verified against the lightest region of `background.webp`
  behind composited glass; never color-alone (icon + shape + text); dark-outermost focus
  ring; opaque + frozen fallbacks.
- **Glass recipe shape is identical** (only fill/blur/saturate values differ):
  chrome `blur(16px) saturate(135%)`, float `blur(20px) saturate(150%)`, inset specular +
  inset hairline rim, app-root baked grain at ~0.05 (0.09 on the hero scrim to kill banding),
  opaque + reduced-motion fallbacks.

---

## Direction 1 — Ember Forge ⭐ RECOMMENDED

**One-liner:** Warm netherite-graphite glass chrome lit by a single molten-ember CTA — the
user's old glass + chromatic-status language, executed with Linear/Raycast discipline so the
build key-art carries the color and ember only ever means "act."

**Key moves**
- Faintly-warm graphite base (hue ~50, chroma ~0.006) — never pure black, never cold blue —
  so the dark plane reads as a forge at dusk and the glass isn't dead.
- One molten-ember accent `oklch(0.70 0.15 52)` on Play / progress / active-nav / focus only;
  dark on-accent text (`#241307`, 6.7:1); CTA = single-hue top-lit gradient + white sheen
  overlay + 1px specular + soft *colored* bloom (not a neutral shadow).
- Status restored chromatic as **colored dot+icon + neutral label**: green Ready, **cool-gold**
  Update (pushed to L0.86 H96 so it can't smear into the ember Play), red Error, blue Info.
- Glass chrome fill 0.72 (sky-band safe), `saturate(135%)` (not 170–180% — high saturate over
  a rainbow photo contaminates the warm-graphite tint).
- Per-build accent **dropped** in favor of a neutral hover-lift; the key-art is the bespoke color.

**Tradeoff:** Warm graphite re-tints every surface + text token together (a half-migration
would clash cold/warm greys), and ember + gold both sit warm — they must stay separated by
lightness (ember L0.70 vs gold L0.86), verified side-by-side near the Play button.

```css
@theme {
  --font-sans: "Nunito", system-ui, sans-serif;

  /* Warm-graphite canvas + opaque surface ladder (lighter = elevated). */
  --color-canvas:    oklch(0.155 0.006 50);
  --color-surface-0: oklch(0.185 0.007 50);
  --color-surface-1: oklch(0.215 0.008 50);
  --color-surface-2: oklch(0.255 0.009 50);
  --color-surface-3: oklch(0.305 0.010 50);

  /* Glass fills — alpha carries contrast over the bright wallpaper. */
  --color-glass-fill:       oklch(0.165 0.008 50 / 0.72); /* chrome: titlebar, nav rail */
  --color-glass-fill-panel: oklch(0.165 0.008 50 / 0.84); /* overlays over opaque body */
  --color-glass-fill-float: oklch(0.150 0.008 50 / 0.90); /* overlays over raw key-art */
  --color-glass-opaque:     oklch(0.150 0.008 50);        /* reduced-transparency fallback */

  /* One ember accent — Play / progress / active-nav / focus / selection. */
  --color-cta:       oklch(0.70 0.15 52);
  --color-cta-hover: oklch(0.74 0.15 52);
  --color-cta-press: oklch(0.64 0.15 50);
  --color-on-cta:    oklch(0.20 0.045 52); /* dark on ember — white-on-ember = 2.8:1, forbidden */
  --color-accent-soft: oklch(0.70 0.15 52 / 0.14);
  --color-accent-glow: oklch(0.70 0.15 52 / 0.40);

  /* Tiered off-white text (never pure #fff). */
  --color-text-hi:    oklch(0.97 0.004 50);
  --color-text:       oklch(0.86 0.006 50);
  --color-text-mute:  oklch(0.66 0.008 50); /* opaque surfaces only; lifts on glass */
  --color-text-faint: oklch(0.50 0.008 50); /* disabled controls only */

  /* Chromatic status — colored DOT/ICON; label text stays neutral (text-hi). */
  --color-ok:    oklch(0.80 0.13 152);  --color-ok-soft:   oklch(0.80 0.13 152 / 0.14);
  --color-warn:  oklch(0.86 0.12 96);   --color-warn-soft: oklch(0.86 0.12 96 / 0.14);
  --color-err:   oklch(0.66 0.18 26);   --color-err-soft:  oklch(0.66 0.18 26 / 0.16);
  --color-info:  oklch(0.74 0.12 235);  --color-info-soft: oklch(0.74 0.12 235 / 0.14);

  /* Hairlines + specular (inset, never a gradient border on blurred elements). */
  --color-line:        oklch(1 0 0 / 0.08);
  --color-line-strong: oklch(1 0 0 / 0.16);
  --glass-spec:        inset 0 1px 0 oklch(1 0 0 / 0.12);
  --glass-spec-cta:    inset 0 1px 0 oklch(1 0 0 / 0.22);

  /* CTA + scrims. */
  --gradient-cta:   linear-gradient(180deg, oklch(0.745 0.155 54), oklch(0.655 0.150 50));
  --gradient-sheen: linear-gradient(180deg, oklch(1 0 0 / 0.15), oklch(1 0 0 / 0.05));
  --scrim-hero: linear-gradient(to top,
    oklch(0.10 0.006 50 / 0.92) 0%, oklch(0.10 0.006 50 / 0.55) 28%,
    oklch(0.10 0.006 50 / 0.28) 52%, oklch(0.10 0.006 50 / 0.10) 74%, transparent 100%);
  --scrim-hero-bloom: radial-gradient(80% 90% at 22% 88%, oklch(0.10 0.006 50 / 0.55), transparent 60%);
  --scrim-global: radial-gradient(125% 120% at 50% 0%, transparent 0%,
      oklch(0.13 0.006 50 / 0.50) 55%, oklch(0.13 0.006 50 / 0.80) 100%),
    linear-gradient(180deg, oklch(0.13 0.006 50 / 0.74) 0%,
      oklch(0.13 0.006 50 / 0.46) 40%, oklch(0.13 0.006 50 / 0.78) 100%);
  --aurora: radial-gradient(60% 50% at 18% -5%, oklch(0.70 0.15 52 / 0.08), transparent 60%);

  --shadow-overlay: 0 16px 48px oklch(0.08 0.006 50 / 0.55);
  --tracking-eyebrow: 0.18em;
}

/* Chrome glass — title bar, nav rail (the ONLY always-on blurs). */
@utility glass {
  position: relative; isolation: isolate;
  background-color: var(--color-surface-2);
  box-shadow: var(--glass-spec), inset 0 0 0 1px oklch(1 0 0 / 0.06);
  @media (prefers-reduced-transparency: no-preference) {
    background-color: var(--color-glass-fill);
    backdrop-filter: blur(16px) saturate(135%);
    transform: translateZ(0);     /* own GPU layer (isolation alone is not promotion) */
    contain: paint;               /* don't let body repaints invalidate the rail backdrop */
  }
}

/* Floating overlay glass — sheets, dropdowns, toasts (one transient surface). */
@utility glass-panel {
  position: relative; isolation: isolate;
  background-color: var(--color-glass-opaque);
  box-shadow: var(--glass-spec), inset 0 0 0 1px oklch(1 0 0 / 0.06), var(--shadow-overlay);
  @media (prefers-reduced-transparency: no-preference) {
    background-color: var(--color-glass-fill-panel);
    backdrop-filter: blur(20px) saturate(150%);
    transform: translateZ(0);
  }
}
/* Over raw key-art (hero version dropdown / toast on detail), bump fill: */
@utility glass-float { background-color: var(--color-glass-fill-float); }

/* Reduced transparency: drop blur, keep the crafted cues. */
@media (prefers-reduced-transparency: reduce) {
  .glass       { background-color: var(--color-glass-opaque) !important; backdrop-filter: none !important; }
  .glass-panel { background-color: var(--color-glass-opaque) !important; backdrop-filter: none !important; }
}
```

**Mockup — catalog + hero:** A near-black warm-graphite window; the bright forest lives
under a global scrim + a barely-there ember aurora bleeding from the top-left, so the room
reads as a calm forge at dusk. A 60px frosted nav-rail floats left (blur 16, faint warm tint,
a 1px specular line along its inner edge); the active "Builds" item carries a 2px ember
left-bar + ember icon, everything else quiet. The frameless title bar is the same glass with
a wide-tracked "LOONTAIL LAUNCHER" wordmark and an ALPHA chip. Content scrolls on opaque
surface-1 cards (no blur): an eyebrow "MY BUILDS" in wide gold-grey micro-caps, then a 3-up
grid — a dashed Create tile, then cards whose 16:9 key-art (vivid grass-green and beach-blue
Minecraft logos) fills the top edge-to-edge over a floor-fade, with a solid body below
carrying the title (Nunito body-med), a meta row in mute, and a status chip: green dot+check
"READY", cool-gold up-arrow "UPDATE", or a quiet "NOT INSTALLED". Hover lifts the card
scale-1.02, drifts the art 1.04 (Ken-Burns), brightens the hairline to white/16 — no colored
glow. Below, an "OFFICIAL" row reads as a richer storefront. In the routed hero, that build's
OWN key-art is the full-bleed (scrollable) backdrop with an eased bottom scrim + a localized
radial bloom pooling darkness bottom-left, where the title sits in Nunito display with a soft
text-shadow and frosted metadata chips. The centerpiece molten PLAY pill: a white sheen over
a top-lit ember gradient, a 1px specular line across the top, dark ember-tinted "Play" label,
and a soft ember bloom from below like heat off lava — unmistakably the single brightest,
warmest object on screen. An opaque sticky hero header pins title + Play on scroll; an opaque
tab strip (About / Media / Servers / Settings) carries an ember underline on the active tab.

---

## Direction 2 — Tideglass

**One-liner:** Cool slate-graphite glass lit by a single cyan/teal CTA tuned to NOT collide
with green Minecraft key-art — the "alive, atmospheric" glass read, made disciplined.

**Key moves**
- Neutral-cool slate base (hue ~250, chroma ~0.008) — cooler than warm Ember, but pulled off
  pure indigo so it doesn't cast on green/red art.
- Accent is a **cyan/teal `oklch(0.76 0.115 215)`** — deliberately ~45° off grass-green so the
  brand UI never blends into the dominant key-art hue, and ~55° off the green Ready status so
  "act" and "ready" never read the same on a 4px dot.
- Status: green Ready (dropped to **L0.70** for a real lightness gap below the brighter
  accent), amber Update, red Error, the accent's own family avoided for status.
- CTA single-hue top-lit cyan gradient + white sheen + dark on-accent text (`#04181c`, ~8:1).
- Cooler base lets a modest `saturate(140%)` restore biome chroma through the glass edges
  without going garish; aurora is a single accent→transparent radial, static.

**Tradeoff:** Cool teal is less obviously "Minecraft-warm" than ember and leans on vivid
key-art to sell the genre; teal accent and green Ready are adjacent enough that the lightness
gap + mandatory icon/shape must carry the distinction at dot scale.

```css
@theme {
  --font-sans: "Nunito", system-ui, sans-serif;

  --color-canvas:    oklch(0.165 0.008 250);
  --color-surface-0: oklch(0.195 0.009 250);
  --color-surface-1: oklch(0.225 0.010 250);
  --color-surface-2: oklch(0.265 0.011 248);
  --color-surface-3: oklch(0.315 0.012 246);

  --color-glass-fill:       oklch(0.175 0.010 250 / 0.72);
  --color-glass-fill-panel: oklch(0.170 0.010 250 / 0.84);
  --color-glass-fill-float: oklch(0.155 0.010 250 / 0.90);
  --color-glass-opaque:     oklch(0.155 0.010 250);

  /* One cyan/teal accent — off green key-art AND off green Ready status. */
  --color-cta:       oklch(0.76 0.115 215);
  --color-cta-hover: oklch(0.80 0.115 215);
  --color-cta-press: oklch(0.70 0.110 213);
  --color-on-cta:    oklch(0.18 0.040 220); /* dark on cyan — white-on-cyan fails AA */
  --color-accent-soft: oklch(0.76 0.115 215 / 0.14);
  --color-accent-glow: oklch(0.76 0.115 215 / 0.38);

  --color-text-hi:    oklch(0.975 0.004 250);
  --color-text:       oklch(0.865 0.008 250);
  --color-text-mute:  oklch(0.66 0.012 250);
  --color-text-faint: oklch(0.50 0.012 250);

  /* Ready dropped to L0.70 for a clear lightness gap below the L0.76 accent. */
  --color-ok:    oklch(0.70 0.15 150);  --color-ok-soft:   oklch(0.70 0.15 150 / 0.14);
  --color-warn:  oklch(0.84 0.13 88);   --color-warn-soft: oklch(0.84 0.13 88 / 0.14);
  --color-err:   oklch(0.66 0.18 26);   --color-err-soft:  oklch(0.66 0.18 26 / 0.16);
  --color-info:  oklch(0.74 0.11 232);  --color-info-soft: oklch(0.74 0.11 232 / 0.14);

  --color-line:        oklch(1 0 0 / 0.08);
  --color-line-strong: oklch(1 0 0 / 0.16);
  --glass-spec:        inset 0 1px 0 oklch(1 0 0 / 0.12);
  --glass-spec-cta:    inset 0 1px 0 oklch(1 0 0 / 0.22);

  --gradient-cta:   linear-gradient(180deg, oklch(0.80 0.115 216), oklch(0.71 0.115 213));
  --gradient-sheen: linear-gradient(180deg, oklch(1 0 0 / 0.15), oklch(1 0 0 / 0.05));
  --scrim-hero: linear-gradient(to top,
    oklch(0.10 0.010 250 / 0.92) 0%, oklch(0.10 0.010 250 / 0.55) 28%,
    oklch(0.10 0.010 250 / 0.28) 52%, oklch(0.10 0.010 250 / 0.10) 74%, transparent 100%);
  --scrim-hero-bloom: radial-gradient(80% 90% at 22% 88%, oklch(0.10 0.010 250 / 0.55), transparent 60%);
  --scrim-global: radial-gradient(125% 120% at 50% 0%, transparent 0%,
      oklch(0.13 0.010 250 / 0.50) 55%, oklch(0.13 0.010 250 / 0.80) 100%),
    linear-gradient(180deg, oklch(0.13 0.010 250 / 0.74) 0%,
      oklch(0.13 0.010 250 / 0.46) 40%, oklch(0.13 0.010 250 / 0.78) 100%);
  --aurora: radial-gradient(58% 48% at 16% -4%, oklch(0.76 0.115 215 / 0.08), transparent 60%);

  --shadow-overlay: 0 16px 48px oklch(0.08 0.010 250 / 0.55);
  --tracking-eyebrow: 0.18em;
}

@utility glass {
  position: relative; isolation: isolate;
  background-color: var(--color-surface-2);
  box-shadow: var(--glass-spec), inset 0 0 0 1px oklch(1 0 0 / 0.06);
  @media (prefers-reduced-transparency: no-preference) {
    background-color: var(--color-glass-fill);
    backdrop-filter: blur(16px) saturate(140%);
    transform: translateZ(0); contain: paint;
  }
}
@utility glass-panel {
  position: relative; isolation: isolate;
  background-color: var(--color-glass-opaque);
  box-shadow: var(--glass-spec), inset 0 0 0 1px oklch(1 0 0 / 0.06), var(--shadow-overlay);
  @media (prefers-reduced-transparency: no-preference) {
    background-color: var(--color-glass-fill-panel);
    backdrop-filter: blur(20px) saturate(150%);
    transform: translateZ(0);
  }
}
@utility glass-float { background-color: var(--color-glass-fill-float); }

@media (prefers-reduced-transparency: reduce) {
  .glass       { background-color: var(--color-glass-opaque) !important; backdrop-filter: none !important; }
  .glass-panel { background-color: var(--color-glass-opaque) !important; backdrop-filter: none !important; }
}
```

**Mockup — catalog + hero:** A cool slate-graphite window where the forest's blues and
birch-greens seep faintly through the frosted chrome edges (saturate 140% restores the
chroma the blur eats), all calmed by the global scrim into a quiet substrate with a single
cyan glow in the top-left corner. The nav-rail's active item is a soft glass pill with a 2px
cyan left-bar + cyan icon; inactive items muted. The catalog is identical structurally to
Ember (opaque cards, eyebrows, floor-fade key-art, status chips) but the active/Play hue is a
cool tide-cyan that reads unmistakably as UI chrome against the warm/green art — never
blending into a grass-block logo. Status chips: a dimmer forest-green dot "READY" (clearly
darker than the brighter cyan accent), amber "UPDATE", red "ERROR". Hover is a neutral
lit-edge + lift, no cyan ring. In the routed hero, the build's own key-art is full-bleed
behind the eased scrim; the PLAY pill is a top-lit cyan gradient under a white sheen with a
dark on-accent label and a soft cyan bloom — the single coolest-bright element, distinct from
every warm pixel of the key-art. Sticky header opaque; tab strip carries a cyan active
underline. The whole thing reads frosted, atmospheric, and premium-cool — the imagery warm,
the chrome cool, the action unmistakable.

---

## Direction 3 — Aurora Noir

**One-liner:** Deep neutral-indigo glass with a single-hue violet CTA and a faint static
aurora wash — the most distinctive, high-end-SaaS read, with the gamer-RGB tells stripped out.

**Key moves**
- Near-neutral cool base (hue ~265, **chroma ~0.010**, lower than pure indigo) so the cool
  cast against green/red key-art is minimal.
- Accent is a **single-hue violet** `oklch(0.72 0.15 288)` — the CTA gradient is violet
  light→dark only (NO violet→cyan rainbow), ~6° hue spread; dark on-accent text.
- The violet→cyan "aurora" idea survives ONLY as the **static, very-low-alpha canvas wash**
  behind the nav (total accent alpha ≤0.08), never as a hard CTA edge and never animated
  behind the always-on chrome blur.
- Per-card hover is **neutral lift only** (no violet ring around warm art).
- One warm on-brand anchor: group eyebrows + wordmark use a faint warm-neutral so the cool
  shell still whispers "Minecraft," not "B2B SaaS."

**Tradeoff:** Cool violet is the least obviously-Minecraft of the three and the aurora trend
is hard-coded to 2024-26 (it could date faster than ember); it leans hardest on vivid key-art
to sell the genre, and the warm-eyebrow anchor is the only earthy touchpoint.

```css
@theme {
  --font-sans: "Nunito", system-ui, sans-serif;

  --color-canvas:    oklch(0.155 0.010 265);
  --color-surface-0: oklch(0.185 0.011 265);
  --color-surface-1: oklch(0.215 0.012 265);
  --color-surface-2: oklch(0.255 0.013 266);
  --color-surface-3: oklch(0.305 0.014 268);

  --color-glass-fill:       oklch(0.170 0.012 265 / 0.72);
  --color-glass-fill-panel: oklch(0.165 0.012 265 / 0.84);
  --color-glass-fill-float: oklch(0.150 0.012 265 / 0.90);
  --color-glass-opaque:     oklch(0.150 0.012 265);

  /* One single-hue violet accent (no rainbow sweep). */
  --color-cta:       oklch(0.72 0.15 288);
  --color-cta-hover: oklch(0.76 0.15 288);
  --color-cta-press: oklch(0.66 0.15 286);
  --color-on-cta:    oklch(0.16 0.030 288); /* dark on violet — white-on-violet = 1.5-2.3:1, forbidden */
  --color-accent-soft: oklch(0.72 0.15 288 / 0.14);
  --color-accent-glow: oklch(0.72 0.15 288 / 0.40);

  --color-text-hi:    oklch(0.975 0.004 265);
  --color-text:       oklch(0.865 0.010 266);
  --color-text-mute:  oklch(0.66 0.014 266);
  --color-text-faint: oklch(0.50 0.016 268);
  --color-eyebrow:    oklch(0.66 0.020 70);  /* warm-neutral anchor for group headers + wordmark */

  --color-ok:    oklch(0.78 0.13 158);  --color-ok-soft:   oklch(0.78 0.13 158 / 0.14);
  --color-warn:  oklch(0.83 0.13 88);   --color-warn-soft: oklch(0.83 0.13 88 / 0.14);
  --color-err:   oklch(0.66 0.18 26);   --color-err-soft:  oklch(0.66 0.18 26 / 0.16);
  --color-info:  oklch(0.76 0.12 232);  --color-info-soft: oklch(0.76 0.12 232 / 0.14);

  --color-line:        oklch(1 0 0 / 0.08);
  --color-line-strong: oklch(1 0 0 / 0.16);
  --glass-spec:        inset 0 1px 0 oklch(1 0 0 / 0.12);
  --glass-spec-cta:    inset 0 1px 0 oklch(1 0 0 / 0.25);

  --gradient-cta:   linear-gradient(180deg, oklch(0.76 0.155 290), oklch(0.66 0.150 286));
  --gradient-sheen: linear-gradient(180deg, oklch(1 0 0 / 0.15), oklch(1 0 0 / 0.05));
  --scrim-hero: linear-gradient(to top,
    oklch(0.10 0.012 265 / 0.92) 0%, oklch(0.10 0.012 265 / 0.55) 28%,
    oklch(0.10 0.012 265 / 0.28) 52%, oklch(0.10 0.012 265 / 0.10) 74%, transparent 100%);
  --scrim-hero-bloom: radial-gradient(80% 90% at 22% 88%, oklch(0.10 0.012 265 / 0.55), transparent 60%);
  --scrim-global: radial-gradient(125% 120% at 50% 0%, transparent 0%,
      oklch(0.13 0.012 265 / 0.52) 55%, oklch(0.13 0.012 265 / 0.80) 100%),
    linear-gradient(180deg, oklch(0.13 0.012 265 / 0.78) 0%,
      oklch(0.13 0.012 265 / 0.50) 40%, oklch(0.13 0.012 265 / 0.80) 100%);
  /* Static aurora wash — two stops, ≤0.08 total, behind content (NOT under always-on chrome). */
  --aurora: radial-gradient(58% 50% at 35% 8%, oklch(0.72 0.15 288 / 0.07), transparent 60%),
            radial-gradient(50% 46% at 88% 16%, oklch(0.74 0.10 215 / 0.05), transparent 62%);

  --shadow-overlay: 0 18px 50px oklch(0.08 0.012 265 / 0.58);
  --tracking-eyebrow: 0.16em;
}

@utility glass {
  position: relative; isolation: isolate;
  background-color: var(--color-surface-2);
  box-shadow: var(--glass-spec), inset 0 0 0 1px oklch(1 0 0 / 0.06);
  @media (prefers-reduced-transparency: no-preference) {
    background-color: var(--color-glass-fill);
    backdrop-filter: blur(16px) saturate(140%);
    transform: translateZ(0); contain: paint;
  }
}
@utility glass-panel {
  position: relative; isolation: isolate;
  background-color: var(--color-glass-opaque);
  box-shadow: var(--glass-spec), inset 0 0 0 1px oklch(1 0 0 / 0.06), var(--shadow-overlay);
  @media (prefers-reduced-transparency: no-preference) {
    background-color: var(--color-glass-fill-panel);
    backdrop-filter: blur(20px) saturate(150%);
    transform: translateZ(0);
  }
}
@utility glass-float { background-color: var(--color-glass-fill-float); }

@media (prefers-reduced-transparency: reduce) {
  .glass       { background-color: var(--color-glass-opaque) !important; backdrop-filter: none !important; }
  .glass-panel { background-color: var(--color-glass-opaque) !important; backdrop-filter: none !important; }
}
```

**Mockup — catalog + hero:** A deep near-neutral-indigo window with a faint STATIC aurora —
a violet bloom in the upper-center, a cooler cyan haze top-right — both pre-darkened by the
global scrim so they read as ambient light, never raw color, and placed in the content zone
(not under the rail) so the always-on chrome blur never re-samples a moving layer. The 36px
glass title bar carries a dim wordmark in a faint warm-neutral (the one earthy anchor) with an
ALPHA pill; its top edge catches a 1px specular hairline. The 60px glass nav-rail's active
"Builds" item wears a soft violet-tinted pill with a 2px violet left-bar. The catalog is the
shared opaque-card grid; group eyebrows ("MY BUILDS" / "OFFICIAL") render in the warm-neutral
micro-caps. Official cards have full-bleed pixel-logo key-art (green grass, blue beach); hover
lifts to surface-2 with a neutral lit edge and a 4% Ken-Burns push — NO violet ring around the
warm art. Status chips on the opaque body: green dot "READY", amber "UPDATE", red "ERROR",
colored dot + neutral label. In the routed hero, the build's own key-art is full-bleed behind
the eased scrim + radial bloom; the PLAY pill is a single-hue violet gradient (light→dark, no
cyan stop) under a white sheen, a 1px specular top highlight, dark on-accent label, and a soft
violet bloom — the single brightest, most-saturated element, unambiguous in the install FSM.
Sticky header opaque; tab strip with a violet active underline. The shell reads cool,
layered, and luminous in exactly one hue — an observatory at night with the Minecraft warmth
supplied entirely by the key-art.

---

## Recommendation

**Ship Ember Forge as the default.** It restores precisely what the user loved — translucent
gradient-glass, a gradient-filled glass CTA, chromatic green/gold/red status, full-bleed
key-art behind frosted panels — while a warm netherite/lava ember is the most on-brand
Minecraft hue and maps cleanest onto the Play/install FSM as the single "act" color. Crucially,
ember is a *warm* accent over *warm/green* key-art, so unlike a green or violet accent it never
blends into a grass-block logo or collides with the green "Ready" status. Tideglass and Aurora
Noir are genuinely premium but lean cooler-and-trendier and depend more on vivid art to read
"Minecraft"; keep them as one-line theme swaps (only the `@theme` values change — structure,
type, motion, and the glass utilities are identical) for A/B and user choice.

---

## Per-direction quick reference

| | Ember Forge ⭐ | Tideglass | Aurora Noir |
|---|---|---|---|
| Base hue / chroma | warm 50 / 0.006–0.010 | cool slate 250 / 0.008–0.012 | neutral-indigo 265 / 0.010–0.014 |
| Accent | ember `oklch(0.70 0.15 52)` | cyan `oklch(0.76 0.115 215)` | violet `oklch(0.72 0.15 288)` |
| On-accent | dark `#241307` (6.7:1) | dark `#04181c` (~8:1) | dark (~6–9:1) |
| chrome saturate | 135% | 140% | 140% |
| Ready status L | 0.80 | 0.70 (gap below accent) | 0.78 |
| Aurora | static ember corner ≤0.08 | static cyan corner ≤0.08 | static 2-stop wash ≤0.08, in content zone |
| Best for | most on-brand, FSM-clean | cool-atmospheric, art-distinct | most distinctive, SaaS-grade |
