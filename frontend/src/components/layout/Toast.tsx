import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { create } from "zustand";

export interface ToastItem {
  id: string;
  message: string;
  onUndo?: () => void;
}

interface ToastState {
  toasts: ToastItem[];
  show: (message: string, onUndo?: () => void) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (message, onUndo) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, message, onUndo }] }));
  },
  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

function ToastMessage({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => onDismiss(item.id), 6000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [item.id, onDismiss]);

  return (
    <div className="flex items-center gap-3 bg-[#1A1A18] text-white px-4 py-3 rounded-lg shadow-lg min-w-[280px] max-w-[400px] animate-slide-up">
      <span className="text-sm flex-1">{item.message}</span>
      {item.onUndo && (
        <button
          onClick={() => {
            item.onUndo!();
            onDismiss(item.id);
          }}
          className="text-amber-400 text-sm font-semibold hover:text-amber-300 cursor-pointer bg-transparent border-none whitespace-nowrap"
        >
          Undo
        </button>
      )}
      <button
        onClick={() => onDismiss(item.id)}
        className="text-[#9CA39A] hover:text-white cursor-pointer bg-transparent border-none p-0.5"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[9999] flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastMessage key={t.id} item={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
