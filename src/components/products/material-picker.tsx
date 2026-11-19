"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { materialUnitLabels } from "@/lib/products/labels";
import type { Material } from "@/types/products";
import { MaterialThumb } from "./material-thumb";

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr");

function details(material: Material): string {
  return [material.color, material.internal_reference, materialUnitLabels[material.unit], material.is_active ? null : "archivée"].filter(Boolean).join(" · ");
}

interface MaterialPickerProps {
  /** Identifiant du bouton, relié au libellé du champ. */
  id: string;
  /** Nom du champ envoyé avec le formulaire. */
  name: string;
  materials: Material[];
  value: string;
  /** Matières déjà utilisées sur une autre ligne de la recette. */
  disabledIds: string[];
  onChange: (materialId: string) => void;
}

/**
 * Choix d'une matière avec sa photo : bouton qui ouvre une liste filtrable (combobox ARIA).
 * Clavier : flèches pour parcourir, Entrée pour choisir, Échap pour fermer.
 */
export function MaterialPicker({ id, name, materials, value, disabledIds, onChange }: MaterialPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const selected = materials.find((material) => material.id === value);
  const listId = `${id}-options`;

  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return materials;
    return materials.filter((material) => normalize(`${material.name} ${material.color ?? ""} ${material.internal_reference ?? ""} ${material.material_categories?.name ?? ""}`).includes(needle));
  }, [materials, query]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  function toggle() {
    if (open) { setOpen(false); return; }
    setQuery("");
    setActive(Math.max(0, materials.findIndex((material) => material.id === value)));
    setOpen(true);
  }

  function pick(material: Material | undefined) {
    if (!material || disabledIds.includes(material.id)) return;
    onChange(material.id);
    setOpen(false);
    trigger.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(filtered.length - 1, index + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === "Enter") { event.preventDefault(); pick(filtered[active]); }
    else if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
  }

  return (
    <div className="material-picker" ref={root}>
      <input type="hidden" name={name} value={value}/>
      <button ref={trigger} id={id} type="button" className="input material-picker-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
        {selected ? <>
          <MaterialThumb url={selected.photo_url} name={selected.name}/>
          <span className="material-picker-text"><strong>{selected.name}</strong><span>{details(selected)}</span></span>
        </> : <span className="material-picker-text"><span>Choisir une matière</span></span>}
        <span className="material-picker-caret" aria-hidden="true">▾</span>
      </button>
      {open && <div className="material-picker-popover">
        <input
          ref={search}
          className="input"
          type="search"
          role="combobox"
          aria-label="Rechercher une matière"
          aria-controls={listId}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
          placeholder="Nom, couleur, référence ou catégorie"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
        />
        {filtered.length === 0 ? <p className="material-picker-empty">Aucune matière ne correspond.</p> : <ul className="material-picker-list" id={listId} role="listbox" aria-label="Matières">
          {filtered.map((material, index) => {
            const disabled = disabledIds.includes(material.id);
            return <li
              key={material.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={material.id === value}
              aria-disabled={disabled}
              className={`material-picker-option${index === active ? " is-active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(material)}
            >
              <MaterialThumb url={material.photo_url} name={material.name} size="medium"/>
              <span className="material-picker-text"><strong>{material.name}</strong><span>{details(material)}{disabled ? " · déjà dans la recette" : ""}</span></span>
            </li>;
          })}
        </ul>}
      </div>}
    </div>
  );
}
