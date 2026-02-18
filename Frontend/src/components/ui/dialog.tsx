import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previousActiveElement = React.useRef<HTMLElement | null>(null);

  // Body scroll lock
  React.useEffect(() => {
    if (open) {
      // Save current scroll position
      const scrollY = window.scrollY;
      // Lock body scroll
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';

      return () => {
        // Restore scroll position
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [open]);

  // Focus trap and initial focus management
  React.useEffect(() => {
    if (open && dialogRef.current) {
      // Save the currently focused element
      previousActiveElement.current = document.activeElement as HTMLElement;

      // Focus the dialog or first focusable element
      const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      if (focusableElements.length > 0) {
        focusableElements[0].focus();
      }

      // Focus trap handler
      const handleTabKey = (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;

        const focusableContent = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (!focusableContent || focusableContent.length === 0) return;

        const firstFocusable = focusableContent[0];
        const lastFocusable = focusableContent[focusableContent.length - 1];

        if (e.shiftKey) {
          // Shift + Tab: moving backwards
          if (document.activeElement === firstFocusable) {
            lastFocusable.focus();
            e.preventDefault();
          }
        } else {
          // Tab: moving forwards
          if (document.activeElement === lastFocusable) {
            firstFocusable.focus();
            e.preventDefault();
          }
        }
      };

      document.addEventListener('keydown', handleTabKey);

      return () => {
        document.removeEventListener('keydown', handleTabKey);
        // Return focus to the previously focused element
        if (previousActiveElement.current) {
          previousActiveElement.current.focus();
        }
      };
    }
  }, [open]);

  // ESC key handler
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop with animation */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm animate-in fade-in-0 duration-200"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      {/* Dialog content wrapper */}
      <div
        ref={dialogRef}
        className="relative z-50 w-full max-w-lg mx-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-description"
      >
        {children}
      </div>
    </div>
  );
}

interface DialogContentProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogContent({ children, className }: DialogContentProps) {
  return (
    <div
      className={cn(
        'relative bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-6 animate-in fade-in-0 zoom-in-95',
        className
      )}
    >
      {children}
    </div>
  );
}

interface DialogHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogHeader({ children, className }: DialogHeaderProps) {
  return (
    <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left mb-4', className)}>
      {children}
    </div>
  );
}

interface DialogTitleProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export function DialogTitle({ children, className, id = 'dialog-title' }: DialogTitleProps) {
  return (
    <h2 id={id} className={cn('text-lg font-semibold leading-none tracking-tight text-white', className)}>
      {children}
    </h2>
  );
}

interface DialogDescriptionProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export function DialogDescription({
  children,
  className,
  id = 'dialog-description',
}: DialogDescriptionProps) {
  return (
    <p id={id} className={cn('text-sm text-gray-300', className)}>
      {children}
    </p>
  );
}

interface DialogFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogFooter({ children, className }: DialogFooterProps) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6',
        className
      )}
    >
      {children}
    </div>
  );
}

interface DialogCloseProps {
  onClose: () => void;
}

export function DialogClose({ onClose }: DialogCloseProps) {
  return (
    <Button
      variant="ghost"
      className="absolute right-4 top-4 h-11 w-11 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      onClick={onClose}
      aria-label="Close dialog"
    >
      <X className="h-4 w-4" />
      <span className="sr-only">Close</span>
    </Button>
  );
}
