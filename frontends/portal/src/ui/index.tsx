import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { Slot } from '@radix-ui/react-slot';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  Files,
  Info,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Upload,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';

export const Icons = {
  ArrowRight,
  Checked: CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Close: X,
  Database,
  EyeVisible: Eye,
  EyeHidden: EyeOff,
  Info,
  ListView: Menu,
  More: MoreHorizontal,
  MultiplePatients: UsersRound,
  Patient: UserRound,
  Plus,
  Refresh: RefreshCw,
  Search,
  Series: Files,
  TabStudies: Files,
  Upload,
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: 'default' | 'outline' | 'ghost' | 'link';
  size?: 'default' | 'icon';
  dataCY?: string;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild, variant = 'default', size = 'default', dataCY, className = '', ...props }, ref) => {
    const Component = asChild ? Slot : 'button';
    return (
      <Component
        ref={ref}
        className={`portal-button portal-button--${variant} portal-button--${size} ${className}`}
        data-cy={dataCY}
        {...(!asChild ? { type: 'button' as const } : {})}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className = '', type = 'text', ...props }, ref) => (
  <input ref={ref} type={type} className={`portal-input ${className}`} {...props} />
));
Input.displayName = 'Input';

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>((props, ref) => <label ref={ref} {...props} />);
Label.displayName = 'Label';

export const Dialog = DialogPrimitive.Root;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export const DialogHeader = ({
  className = '',
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`portal-dialog-header ${className}`} {...props} />
);

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className = '', children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="portal-dialog-overlay" />
    <DialogPrimitive.Content ref={ref} className={`portal-dialog ${className}`} {...props}>
      {children}
      <DialogPrimitive.Close
        className="portal-dialog-close"
        data-cy="dialog-close-button"
        aria-label="关闭"
      >
        <X aria-hidden="true" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(({ className = '', sideOffset = 4, ...props }, ref) => (
  <DropdownPrimitive.Portal>
    <DropdownPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={`portal-menu ${className}`}
      {...props}
    />
  </DropdownPrimitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';
export const DropdownMenuItem = DropdownPrimitive.Item;
