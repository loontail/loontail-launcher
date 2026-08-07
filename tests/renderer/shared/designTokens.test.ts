import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { glob } from 'tinyglobby';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

// Tailwind v4 silently drops a utility whose token is undefined, so the class
// leaves `--tw-*` at its `@property` initial value (e.g. ring-offset falls back
// to #fff) with no build error, and a var() naming a dropped token resolves to
// nothing. This test is the only gate on both.
const THEME_CSS = readFileSync(`${repoRoot}/src/renderer/index.css`, 'utf8');

const definedTokens = (group: string): ReadonlySet<string> => {
  const names = new Set<string>();
  const pattern = new RegExp(`--${group}-([a-z0-9-]+)\\s*:`, 'g');
  for (const match of THEME_CSS.matchAll(pattern)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return names;
};

const COLOR_TOKENS = definedTokens('color');
const TEXT_TOKENS = definedTokens('text');
const SHADOW_TOKENS = definedTokens('shadow');

// Tailwind built-ins the renderer uses with a colour-ish prefix. Anything not
// listed here has to resolve against a token declared in index.css.
const BUILT_IN_VALUES: ReadonlySet<string> = new Set([
  'transparent',
  'current',
  'inherit',
  'none',
  'inset',
  'balance',
  'pretty',
  'ellipsis',
  'clip',
  'nowrap',
  'wrap',
  'left',
  'right',
  'center',
  'justify',
  'start',
  'end',
  'solid',
  'dashed',
  'dotted',
  'double',
  'hidden',
  '2xs',
  'xs',
  'sm',
  'base',
  'md',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
  '8xl',
  '9xl',
  'linear-to-b',
  'linear-to-t',
  'linear-to-l',
  'linear-to-r',
  'cover',
  'contain',
  'fixed',
  'local',
  'scroll',
  'no-repeat',
  'repeat',
]);

const SIDE_PREFIXES = ['b', 't', 'l', 'r', 'x', 'y', 's', 'e'];

// Several prefixes also spell a width/side utility that never resolves against a
// colour token: `border-b`, `border-l-2`, `divide-y`, `ring-offset-2`.
const WIDTH_VALUE = /^(?:[btlrxyse](?:-\d+(?:\.\d+)?)?|\d+(?:\.\d+)?)$/;

// `ring-offset` must precede `ring`; the alternation is matched left to right.
// The value group has to accept a leading digit, otherwise `ring-offset-2`
// backtracks onto the shorter `ring-` prefix and is read as `ring-offset-2`.
const UTILITY_PATTERN =
  /\b(bg|ring-offset|ring|divide|from|via|to|fill|stroke|outline|placeholder|caret|decoration|border|shadow|text)-([a-z0-9][a-z0-9-]*)/g;

const VAR_PATTERN = /var\(--([a-z0-9-]+)\)/g;

const TOKEN_GROUPS: Readonly<Record<string, ReadonlyArray<ReadonlySet<string>>>> = {
  text: [COLOR_TOKENS, TEXT_TOKENS],
  shadow: [SHADOW_TOKENS, COLOR_TOKENS],
};

const resolves = (prefix: string, value: string): boolean => {
  if (WIDTH_VALUE.test(value)) return true;
  if (BUILT_IN_VALUES.has(value)) return true;
  const groups = TOKEN_GROUPS[prefix] ?? [COLOR_TOKENS];
  if (groups.some((group) => group.has(value))) return true;
  const [side, ...rest] = value.split('-');
  if (side !== undefined && rest.length > 0 && SIDE_PREFIXES.includes(side)) {
    return resolves(prefix, rest.join('-'));
  }
  return false;
};

describe('renderer design tokens', () => {
  it('resolves every token-based utility against index.css', async () => {
    const files = await glob('src/renderer/**/*.{ts,tsx}', { cwd: repoRoot, absolute: true });
    expect(files.length).toBeGreaterThan(0);

    const unresolved: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const relative = file.slice(repoRoot.length).replaceAll('\\', '/');
      for (const match of source.matchAll(UTILITY_PATTERN)) {
        const [utility, prefix, value] = match;
        if (prefix === undefined || value === undefined) continue;
        if (resolves(prefix, value)) continue;
        unresolved.push(`${relative}: ${utility}`);
      }
      // Arbitrary-value utilities (`shadow-[0_0_8px_var(--color-glow-glass)]`) are
      // invisible to UTILITY_PATTERN: its value group requires a leading [a-z0-9],
      // so `shadow-[` never matches. A var() naming a token index.css no longer
      // declares resolves to nothing and the glow silently disappears — exactly
      // the failure this file exists to catch.
      for (const match of source.matchAll(VAR_PATTERN)) {
        const token = match[1];
        if (token === undefined) continue;
        if (THEME_CSS.includes(`--${token}:`)) continue;
        unresolved.push(`${relative}: var(--${token})`);
      }
    }

    expect([...new Set(unresolved)].sort()).toEqual([]);
  });
});
