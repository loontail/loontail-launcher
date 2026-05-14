import { cn } from '@renderer/shared/lib/cn';
import type { InputHTMLAttributes, ReactElement } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = ({ className, type = 'text', ...rest }: InputProps): ReactElement => (
  <input
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
