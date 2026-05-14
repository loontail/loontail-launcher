import { cn } from '@renderer/shared/lib/cn';
import type { ChangeEvent } from 'react';

type SliderProps = {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
};

export const Slider = ({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  disabled = false,
  className,
}: SliderProps) => {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onValueChange(Number(event.target.value));
  };

  const progress = max === min ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <input
      type="range"
      value={value}
      onChange={handleChange}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn(
        'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary',
        '[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      style={{
        background: `linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) ${progress}%, var(--color-muted) ${progress}%, var(--color-muted) 100%)`,
      }}
    />
  );
};
