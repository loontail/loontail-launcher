import { cn } from '@renderer/shared/lib/cn';
import type { InputHTMLAttributes, Ref } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  ref?: Ref<HTMLInputElement>;
};

export const Input = ({ className, type = 'text', ref, ...rest }: InputProps) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      'flex h-9 w-full rounded-sm border border-input bg-background px-3 py-1 text-sm',
      'placeholder:text-muted-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...rest}
  />
);
