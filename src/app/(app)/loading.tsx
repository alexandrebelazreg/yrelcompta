/** Squelette affiché instantanément pendant le chargement d’une page : la navigation reste en place. */
export default function AppLoading() {
  return (
    <div className="page-skeleton" role="status" aria-label="Chargement de la page">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-subtitle" />
      <div className="skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="skeleton skeleton-card" />)}
      </div>
      {Array.from({ length: 5 }, (_, index) => <div key={index} className="skeleton skeleton-row" />)}
    </div>
  );
}
