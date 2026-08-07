// @vitest-environment jsdom
import { OverrideMark } from '@renderer/shared/ui/OverrideMark';
import { Segmented } from '@renderer/shared/ui/Segmented';
import { Switch } from '@renderer/shared/ui/Switch';
import { cleanup, render } from '@testing-library/react';
import { Settings } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

describe('Segmented', () => {
  const options = [
    { value: 'a' as const, label: 'Alpha' },
    { value: 'b' as const, label: 'Beta' },
  ];

  it('exposes a radiogroup of radios with the selected one checked', () => {
    const { container } = render(<Segmented options={options} value="b" onChange={vi.fn()} />);
    const group = container.querySelector('[role="radiogroup"]');
    const radios = container.querySelectorAll('[role="radio"]');
    expect(group).not.toBeNull();
    expect(radios).toHaveLength(2);
    expect(radios[0]?.getAttribute('aria-checked')).toBe('false');
    expect(radios[1]?.getAttribute('aria-checked')).toBe('true');
  });

  it('pads labelled segments and sizes icon-only segments instead', () => {
    const labelled = render(<Segmented options={options} value="a" onChange={vi.fn()} />);
    const labelledClass = labelled.container.querySelector('[role="radio"]')?.className ?? '';
    expect(labelledClass).toContain('px-3');
    expect(labelledClass).not.toMatch(/\bw-[78]\b/);
    cleanup();

    const iconOnly = render(
      <Segmented
        options={[{ value: 'a' as const, icon: Settings, ariaLabel: 'Settings' }]}
        value="a"
        onChange={vi.fn()}
        size="sm"
      />,
    );
    const iconClass = iconOnly.container.querySelector('[role="radio"]')?.className ?? '';
    expect(iconClass).toContain('w-7');
    expect(iconClass).not.toContain('px-3');
  });
});

describe('Switch', () => {
  it('carries role=switch with aria-checked only when interactive', () => {
    const { container } = render(<Switch checked onCheckedChange={vi.fn()} label="Toggle" />);
    const el = container.querySelector('span');
    expect(el?.getAttribute('role')).toBe('switch');
    expect(el?.getAttribute('aria-checked')).toBe('true');
  });

  it('is decorative and hidden from the tree when no handler is passed', () => {
    const { container } = render(<Switch checked />);
    const el = container.querySelector('span');
    expect(el?.getAttribute('role')).toBeNull();
    expect(el?.getAttribute('aria-checked')).toBeNull();
    expect(el?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('OverrideMark', () => {
  it('labels the asterisk as an image so it is announced, not read as punctuation', () => {
    const { container } = render(<OverrideMark shown />);
    const el = container.querySelector('span');
    expect(el?.getAttribute('role')).toBe('img');
    expect(el?.getAttribute('aria-label')).toBe('overridden');
  });

  it('renders nothing when not shown', () => {
    const { container } = render(<OverrideMark shown={false} />);
    expect(container.firstChild).toBeNull();
  });
});
