import { cn } from '@renderer/shared/lib/cn';
import { Splide, SplideSlide } from '@splidejs/react-splide';
import type { Splide as SplideInstance } from '@splidejs/splide';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Children, type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const AUTOPLAY_INTERVAL_MS = 5000;

type CarouselProps = {
  children: ReactNode;
  autoPlay?: boolean;
  loop?: boolean;
  speed?: number;
};

const navButtonClass = cn(
  'pointer-events-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-full',
  'border border-edge-md bg-modal text-glass backdrop-blur-sm transition-all duration-150',
  'hover:scale-110 hover:bg-backdrop',
);

export const Carousel = ({
  children,
  autoPlay = false,
  loop = true,
  speed = 700,
}: CarouselProps) => {
  const { t } = useTranslation();
  const splideRef = useRef<SplideInstance | null>(null);
  const slides = Children.toArray(children);
  const showNavigation = slides.length > 1;

  return (
    <div className="relative overflow-hidden">
      <Splide
        ref={(splide) => {
          splideRef.current = splide?.splide ?? null;
        }}
        options={{
          type: loop ? 'loop' : 'slide',
          perPage: 1,
          autoplay: autoPlay,
          interval: AUTOPLAY_INTERVAL_MS,
          speed,
          pagination: false,
          arrows: false,
          drag: false,
        }}
      >
        {slides.map((child, index) => (
          <SplideSlide
            // biome-ignore lint/suspicious/noArrayIndexKey: slides are not reordered
            key={index}
            className="box-border h-auto"
          >
            {child}
          </SplideSlide>
        ))}
      </Splide>

      {showNavigation && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-between px-3">
          <button
            type="button"
            onClick={() => splideRef.current?.go('<')}
            className={navButtonClass}
            aria-label={t('common.carousel.previous')}
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => splideRef.current?.go('>')}
            className={navButtonClass}
            aria-label={t('common.carousel.next')}
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
