import type { ReactNode } from "react";
import { Card } from "./card";
import { InfoTip } from "./info-tip";

export function MetricCard({ label, value, help, secondary, action }: { label: string; value: ReactNode; help?: ReactNode; secondary?: ReactNode; action?: ReactNode }) {
  return (
    <Card className="metric-card">
      <div className="metric-label">
        <span>{label}</span>
        {help && <InfoTip label={`En savoir plus sur ${label}`}>{help}</InfoTip>}
      </div>
      <strong>{value}</strong>
      {secondary && <small className="metric-secondary">{secondary}</small>}
      {action}
    </Card>
  );
}
