"use client";

import { useEffect, useRef } from "react";

// A popup over the page, in the style of screen 07.
// Uses the browser's own <dialog> element: it keeps keyboard focus inside the
// popup and closes on Esc, so we don't have to build that ourselves.
// Used by the duplicate prompt and the edit / delete popups in the links table.
export default function Modal({ open, onClose, labelledBy, children }) {
  const dialogRef = useRef(null);

  // <dialog> is opened and closed with methods, not with a prop.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      // Esc: let React decide (onClose) instead of the browser closing it alone.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A click on the dark area around the popup lands on <dialog> itself.
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className="m-auto w-[min(92vw,32rem)] rounded-2xl bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-zinc-900/50"
    >
      {open && <div className="p-6">{children}</div>}
    </dialog>
  );
}
