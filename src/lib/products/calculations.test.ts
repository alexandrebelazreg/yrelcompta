import{describe,expect,it}from"vitest";import{calculateProductCost,calculateRawMaterialsCents}from"./calculations";
const material=(cost:number,pack:number,used:number)=>({packageCostCents:cost,packageQuantityMilliunits:pack,quantityMilliunits:used});
const base={materials:[],materialLossBasisPoints:0,laborMinutes:0,packagingCostCents:null,salePriceCents:0,settings:{labor_hourly_rate_cents:0,default_packaging_cost_cents:0}};
describe("coût de fabrication exact",()=>{
 it("conserve un composant inférieur à un centime jusqu'à l'arrondi final",()=>expect(calculateRawMaterialsCents([material(100,100000,1)])).toBe(0));
 it("additionne plusieurs petits composants avant l'unique arrondi",()=>expect(calculateRawMaterialsCents([material(1,1000,400),material(1,1000,400),material(1,1000,400)])).toBe(1));
 it("ne somme pas des arrondis matière par matière",()=>{const lines=[material(1,1000,400),material(1,1000,400)];expect(lines.reduce((n,l)=>n+calculateRawMaterialsCents([l]),0)).toBe(0);expect(calculateRawMaterialsCents(lines)).toBe(1)});
 it("calcule une quantité fractionnaire en grammes",()=>expect(calculateRawMaterialsCents([material(250,25000,1250)])).toBe(13));
 it("calcule une quantité fractionnaire en centimètres",()=>expect(calculateRawMaterialsCents([material(800,250000,12500)])).toBe(40));
 it.each([[0,0],[500,5],[10000,100]])("calcule les pertes à %i points de base",(basisPoints,expected)=>expect(calculateProductCost({...base,materials:[material(100,1000,1000)],materialLossBasisPoints:basisPoints}).materialLossCents).toBe(expected));
 it("accepte un taux horaire nul",()=>expect(calculateProductCost({...base,laborMinutes:90}).laborCents).toBe(0));
 it("arrondit la main-d'œuvre au centime",()=>expect(calculateProductCost({...base,laborMinutes:1,settings:{...base.settings,labor_hourly_rate_cents:100}}).laborCents).toBe(2));
 it("préfère l'emballage du produit au défaut",()=>expect(calculateProductCost({...base,packagingCostCents:25,settings:{...base.settings,default_packaging_cost_cents:80}}).packagingCents).toBe(25));
 it("gère un prix nul sans taux de marge",()=>expect(calculateProductCost(base).marginRatePercent).toBeNull());
 it("conserve une marge négative",()=>expect(calculateProductCost({...base,packagingCostCents:200,salePriceCents:100}).grossMarginCents).toBe(-100));
 it("calcule de grands montants sans perte de précision",()=>expect(calculateRawMaterialsCents([material(9000000000000,9000000000000000,4500000000000000)])).toBe(4500000000000));
 it("accepte une recette vide",()=>expect(calculateRawMaterialsCents([])).toBe(0));
 it("calcule encore une matière archivée déjà présente",()=>expect(calculateRawMaterialsCents([material(199,1000,1000)])).toBe(199));
});
