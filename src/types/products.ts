export type MaterialUnit="piece"|"gram"|"centimeter"|"milliliter";
export type ProductCategory="necklace"|"bracelet"|"earrings"|"ring"|"accessory"|"other";
export interface Material{id:string;business_id:string;name:string;internal_reference:string|null;supplier_id:string|null;unit:MaterialUnit;package_quantity_milliunits:number;package_cost_cents:number;notes:string|null;is_active:boolean;suppliers:{name:string}|null}
export interface RecipeLine{id:string;material_id:string;quantity_milliunits:number;position:number;materials:Material|null}
export interface Product{id:string;business_id:string;name:string;sku:string|null;category:ProductCategory;sale_price_cents:number;labor_minutes:number;packaging_cost_cents:number|null;material_loss_basis_points:number;notes:string|null;is_active:boolean;product_materials:RecipeLine[]}
export interface CostingSettings{labor_hourly_rate_cents:number;default_packaging_cost_cents:number}
export interface ProductCosting{rawMaterialsCents:number;materialLossCents:number;laborCents:number;packagingCents:number;manufacturingCostCents:number;grossMarginCents:number;marginRatePercent:number|null}
export interface ProductListItem extends Product{costing:ProductCosting}
