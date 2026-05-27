import React, { type ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  confirmDisabled = false,
}) => {
  if (!open) return null;

  return (
    <>
      <style>{`
        @keyframes dialog-backdrop-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes dialog-pop-in {
          0% {
            opacity: 0;
            transform: translateY(16px) scale(0.95);
          }
          60% {
            opacity: 1;
            transform: translateY(-4px) scale(1.01);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .dialog-backdrop {
          animation: dialog-backdrop-in 0.2s ease-out both;
        }
        .dialog-card {
          animation: dialog-pop-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
      `}</style>

      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm dialog-backdrop"
        onClick={onClose}
      >
        <div
          className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4 dialog-card"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
          <div className="text-sm text-gray-400 mb-6">{message}</div>
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="btn-ghost btn-sm">
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmDisabled}
              className={destructive ? "btn-danger btn-sm" : "btn-primary btn-sm"}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default React.memo(ConfirmDialog);
