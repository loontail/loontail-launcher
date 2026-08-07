import backdrop from '@renderer/assets/backgrounds/6.webp';
import { useNavigationStore } from '@renderer/shared/lib/stores/navigation';
import { Button } from '@renderer/shared/ui/Button';
import { Boxes } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const HomeEmptyState = () => {
  const { t } = useTranslation();
  const push = useNavigationStore((s) => s.push);

  return (
    <div className="relative h-full overflow-hidden">
      <img
        src={backdrop}
        alt=""
        aria-hidden
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
      <div className="absolute inset-0 bg-canvas/30" />
      <div className="absolute inset-0 bg-linear-to-r from-canvas via-transparent to-canvas" />
      <div className="absolute inset-0 bg-linear-to-b from-canvas/40 via-transparent to-canvas" />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 62% 58% at 50% 50%, oklch(0.145 0 0 / 0.62), transparent 72%)',
        }}
      />

      <div className="relative flex h-full flex-col items-center justify-center gap-5 px-12 text-center">
        <span className="flex size-16 items-center justify-center rounded-2xl border border-edge bg-surface-1/70 text-text-mute backdrop-blur-sm">
          <Boxes className="size-7" />
        </span>
        <div className="flex max-w-sm flex-col gap-2 text-balance">
          <h2 className="text-h1 text-text-hi drop-shadow-[0_2px_16px_var(--color-glow-overlay-lg)]">
            {t('home.emptyTitle')}
          </h2>
          <p className="text-body text-text drop-shadow-[0_1px_10px_var(--color-glow-overlay-lg)]">
            {t('home.emptyDescription')}
          </p>
        </div>
        <Button variant="secondary" onClick={() => push({ name: 'builds' })}>
          <Boxes className="size-4" />
          {t('home.emptyCta')}
        </Button>
      </div>
    </div>
  );
};
