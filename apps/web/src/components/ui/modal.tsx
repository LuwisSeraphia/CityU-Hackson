"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./button";
export function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  function close() {
    if (!ref.current?.querySelector('[aria-busy="true"]')) onClose();
  }
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <Button
          aria-label="关闭"
          onClick={close}
          className="icon-button"
          autoFocus
        >
          <X size={19} />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
