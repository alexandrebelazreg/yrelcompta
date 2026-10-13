import type{MaterialUnit}from"@/types/products";
export const materialUnitLabels:Record<MaterialUnit,string>={piece:"pièce",gram:"gramme",centimeter:"centimètre",milliliter:"millilitre"};
export const defaultProductCategories=["Collier","Bracelet","Boucles d’oreilles","Bague","Accessoire","Autre"];
export const defaultMaterialColors=["Argent","Doré"];
export function normalizeLabel(value:string){return value.trim().replace(/\s+/g," ")}
/** Réutilise la casse d’un libellé connu (« doré » → « Doré ») pour éviter les doublons. */
export function canonicalLabel(value:string,known:string[]){const cleaned=normalizeLabel(value);return known.find(k=>k.toLocaleLowerCase("fr")===cleaned.toLocaleLowerCase("fr"))??cleaned}
/** Options proposées : libellés par défaut puis libellés créés par l’entreprise, sans doublon. */
export function mergeLabelOptions(defaults:string[],used:Array<string|null|undefined>){const result=[...defaults];for(const value of used){if(value&&!result.some(r=>r.toLocaleLowerCase("fr")===value.toLocaleLowerCase("fr")))result.push(value)}return[...defaults,...result.slice(defaults.length).sort((a,b)=>a.localeCompare(b,"fr"))]}
