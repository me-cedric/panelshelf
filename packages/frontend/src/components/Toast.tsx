import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  description?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const ICONS: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const STYLES: Record<ToastType, { border: string; bg: string; icon: string }> = {
  success: {
    border: "border-green-500/30",
    bg: "bg-green-500/10",
    icon: "text-green-400",
  },
  error: {
    border: "border-red-500/30",
    bg: "bg-red-500/10",
    icon: "text-red-400",
  },
  info: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/10",
    icon: "text-blue-400",
  },
  warning: {
    border: "border-yellow-500/30",
    bg: "bg-yellow-500/10",
    icon: "text-yellow-400",
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev, { ...toast, id }]);
      const timer = setTimeout(() => removeToast(id), 4000);
      timersRef.current.set(id, timer);
    },
    [removeToast],
  );

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}

      <style>{`
        @keyframes toast-slide-in {
          0% {
            opacity: 0;
            transform: translateX(80px) scale(0.92);
          }
          40% {
            opacity: 1;
            transform: translateX(-8px) scale(1.02);
          }
          70% {
            transform: translateX(4px) scale(0.99);
          }
          100% {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }
        .toast-enter {
          animation: toast-slide-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
      `}</style>

      {/* Toast container */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type];
          const styles = STYLES[toast.type];
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto w-80 rounded-lg border ${styles.border} ${styles.bg} backdrop-blur-sm p-3 shadow-lg shadow-black/20 toast-enter`}
            >
              <div className="flex items-start gap-3">
                <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${styles.icon}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200">{toast.message}</p>
                  {toast.description && (
                    <p className="text-xs text-gray-400 mt-0.5">{toast.description}</p>
                  )}
                </div>
                <button
                  onClick={() => removeToast(toast.id)}
                  className="shrink-0 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
