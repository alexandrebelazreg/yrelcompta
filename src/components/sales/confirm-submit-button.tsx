"use client";
import { useFormStatus } from "react-dom";

export function ConfirmSubmitButton({ children, message, danger = false }: { children: string; message: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={danger ? "button danger-button" : "button"} type="submit" disabled={pending} onClick={(event) => { if (!window.confirm(message)) event.preventDefault(); }}>{pending ? "Veuillez patienter…" : children}</button>;
}
