import type { ReactNode } from "react";

export function InfoTip({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <details className={["info-tip", className].filter(Boolean).join(" ")}>
      <summary aria-label={label}>i</summary>
      <div className="info-tip-panel">{children}</div>
    </details>
  );
}
