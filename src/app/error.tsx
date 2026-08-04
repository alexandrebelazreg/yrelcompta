"use client";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main className="centered-message"><p className="eyebrow">Un imprévu est survenu</p><h1>Cette page ne peut pas être affichée</h1><p>Vos données n’ont pas été modifiées. Vous pouvez réessayer.</p><button className="button" onClick={reset}>Réessayer</button></main>; }
