import { Icon } from "./icon";

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <div aria-hidden="true" className="empty-state-icon"><Icon name="products" /></div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
