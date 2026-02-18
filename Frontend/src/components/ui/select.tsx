import * as React from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectContextValue {
  value: string;
  onValueChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  contentId: string;
  triggerId: string;
  focusedIndex: number;
  setFocusedIndex: React.Dispatch<React.SetStateAction<number>>;
}

const SelectContext = React.createContext<SelectContextValue | undefined>(undefined);

function useSelectContext() {
  const context = React.useContext(SelectContext);
  if (!context) {
    throw new Error('Select components must be used within a Select component');
  }
  return context;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}

function Select({ value, onValueChange, children }: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const [focusedIndex, setFocusedIndex] = React.useState(-1);
  const contentId = React.useId();
  const triggerId = React.useId();

  return (
    <SelectContext.Provider
      value={{
        value,
        onValueChange,
        open,
        setOpen,
        contentId,
        triggerId,
        focusedIndex,
        setFocusedIndex,
      }}
    >
      <div className="relative">{children}</div>
    </SelectContext.Provider>
  );
}

interface SelectTriggerProps {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ children, className, disabled }, ref) => {
    const { open, setOpen, contentId, triggerId } = useSelectContext();

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (disabled) return;

      switch (e.key) {
        case 'Enter':
        case ' ':
        case 'ArrowDown':
        case 'ArrowUp':
          e.preventDefault();
          setOpen(true);
          break;
        case 'Escape':
          if (open) {
            e.preventDefault();
            setOpen(false);
          }
          break;
      }
    };

    return (
      <button
        ref={ref}
        id={triggerId}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={contentId}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
          className
        )}
      >
        {children}
        <ChevronDown className="h-4 w-4 opacity-50" />
      </button>
    );
  }
);
SelectTrigger.displayName = 'SelectTrigger';

interface SelectValueProps {
  placeholder?: string;
}

function SelectValue({ placeholder }: SelectValueProps) {
  const { value } = useSelectContext();
  return <span className={!value ? 'text-muted-foreground' : ''}>{value || placeholder}</span>;
}

interface SelectContentProps {
  children: React.ReactNode;
  className?: string;
}

function SelectContent({ children, className }: SelectContentProps) {
  const { open, setOpen, contentId, focusedIndex, setFocusedIndex } = useSelectContext();
  const contentRef = React.useRef<HTMLDivElement>(null);

  // Click outside handler - use mouseup to not interfere with item clicks
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Check if click is inside the dropdown content or trigger
      if (target.closest('[data-select-content]')) return;
      if (target.closest('[role="combobox"]')) return;
      setOpen(false);
    };

    if (open) {
      // Use setTimeout to avoid closing on the same click that opened it
      const timeoutId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 0);
      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [open, setOpen]);

  // ESC key handler
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        // Return focus to trigger
        const trigger = document.getElementById(
          document.querySelector(`[aria-controls="${contentId}"]`)?.id || ''
        );
        trigger?.focus();
      }
    };

    if (open) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, setOpen, contentId]);

  // Keyboard navigation
  React.useEffect(() => {
    if (!open || !contentRef.current) return;

    const items = contentRef.current.querySelectorAll('[role="option"]');

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!items.length) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev: number) => (prev < items.length - 1 ? prev + 1 : 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev: number) => (prev > 0 ? prev - 1 : items.length - 1));
          break;
        case 'Home':
          e.preventDefault();
          setFocusedIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setFocusedIndex(items.length - 1);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, setFocusedIndex]);

  // Focus management
  React.useEffect(() => {
    if (open && focusedIndex >= 0 && contentRef.current) {
      const items = contentRef.current.querySelectorAll('[role="option"]');
      const item = items[focusedIndex] as HTMLElement;
      item?.focus();
    }
  }, [focusedIndex, open]);

  if (!open) return null;

  return (
    <div
      ref={contentRef}
      id={contentId}
      data-select-content
      role="listbox"
      className={cn(
        'absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-white text-gray-900 shadow-lg animate-in fade-in-0 zoom-in-95',
        className
      )}
    >
      <div className="p-1">{children}</div>
    </div>
  );
}

interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

function SelectItem({ value, children, className }: SelectItemProps) {
  const {
    value: selectedValue,
    onValueChange,
    setOpen,
    focusedIndex,
    setFocusedIndex,
  } = useSelectContext();
  const isSelected = selectedValue === value;
  const itemRef = React.useRef<HTMLButtonElement>(null);
  const [index, setIndex] = React.useState(-1);

  // Register this item's index
  React.useEffect(() => {
    if (!itemRef.current) return;
    const parent = itemRef.current.closest('[role="listbox"]');
    if (!parent) return;
    const items = Array.from(parent.querySelectorAll('[role="option"]'));
    setIndex(items.indexOf(itemRef.current));
  }, []);

  const selectItem = () => {
    onValueChange(value);
    setOpen(false);
    // Return focus to trigger
    const trigger = document.querySelector('[role="combobox"]') as HTMLElement;
    trigger?.focus();
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    selectItem();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectItem();
    }
  };

  const isFocused = focusedIndex === index;

  return (
    <button
      ref={itemRef}
      type="button"
      role="option"
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onFocus={() => setFocusedIndex(index)}
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground',
        isSelected && 'bg-accent',
        className
      )}
    >
      {children}
      {isSelected && (
        <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
          <Check className="h-4 w-4" />
        </span>
      )}
    </button>
  );
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
