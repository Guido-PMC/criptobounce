import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Premium baseline: smooth easing, micro scale on press, focus ring with offset.
  // Buttons feel responsive without ever overshooting (durations ≤ 200ms).
  [
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium',
    'transition-[transform,box-shadow,background-color,color,opacity] duration-200 ease-out',
    'will-change-transform select-none',
    'active:scale-[0.97]',
    'disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  ].join(' '),
  {
    variants: {
      variant: {
        // Primary: subtle lift + shadow on hover, very small scale to feel "alive".
        default:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/95 hover:shadow-md hover:-translate-y-[1px]',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:shadow-md hover:-translate-y-[1px]',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground hover:border-foreground/20',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/85 hover:shadow-sm',
        ghost:
          'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
