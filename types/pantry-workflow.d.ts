/** Checked contracts for the two pure pantry models; no runtime code. */
export type StockMap = Record<string, number>;
export type CanonicalId = (name: string, unit: string) => string;
export interface IngredientRequirement {
  key?: string;
  name?: string;
  unit: string | null;
  required: number | null;
  packQuantity?: number;
  packUnit?: string;
  reviewed?: boolean;
  packReviewed?: boolean;
  measurementReviewed?: boolean;
  estimated?: boolean;
  assumption?: string;
}
export interface ReviewedStockConversion {
  reviewed: boolean;
  packQuantity: number;
  packUnit: string;
  stockKey?: string;
  canonicalKey?: string;
  sourceUnit?: string;
  estimated?: boolean;
  assumption?: string;
}
export interface FoodConversion {
  canonicalKey?: string;
  densityGPerMl?: number;
  gramsPerEach?: number;
  estimated?: boolean;
  assumption?: string;
}
export interface PantryConversionContext {
  /** Enables status/container staples and labelled UK pack defaults. */
  pantryMode?: boolean;
  staples?: Record<string, 'in' | 'in_stock' | 'low' | 'out' | 'unknown' | {
    status?: 'in' | 'in_stock' | 'low' | 'out' | 'unknown';
    stapleStatus?: 'in' | 'in_stock' | 'low' | 'out' | 'unknown';
    count?: number;
  }>;
  stock?: Record<string, ReviewedStockConversion>;
  foods?: Record<string, FoodConversion>;
  canonicalMeasure?: (name: string, quantity: number, unit: string, context?: { market?: string }) => {
    key?: string;
    quantity: number;
    unit: string;
    estimated?: boolean;
    needsReview?: boolean;
    assumption?: string | null;
  } | null;
  basis?: { wholeProduce?: boolean; spoons?: boolean };
  market?: string;
}
export interface StockAllocation {
  stockKey: string;
  sourceUnit: string;
  sourceQuantity: number;
  unit: string;
  quantity: number;
  estimated: boolean;
  assumptions: string[];
}
export interface ReviewedAmount { id: string; quantity: number; unit: string | null }
export interface DeductionInput {
  stock: StockMap;
  ingredients: IngredientRequirement[];
  amounts?: ReviewedAmount[];
  id?: CanonicalId;
  conversion?: PantryConversionContext | null;
}
export type DeductionIssue = 'amount_unknown' | 'unit_unknown' | 'unit_mismatch';
export interface DeductionRow {
  id: string;
  name: string;
  unit: string | null;
  required: number | null;
  owned: number;
  deduct: number;
  remaining: number;
  canDeduct: boolean;
  issue: DeductionIssue | null;
  issueLabel: string;
  canonicalKey?: string | null;
  estimated?: boolean;
  assumptions?: string[];
  allocations?: StockAllocation[];
  staple?: boolean;
  stapleStatus?: 'in' | 'low' | 'out' | 'unknown';
  stapleRestock?: boolean;
  stapleCount?: number;
  /** Status coverage for a culinary staple amount; never a measured deduction. */
  covered?: boolean;
  stockLabel?: string;
}
export interface UsedIngredient { id: string; key: string; unit: string; required: number; estimated?: boolean; assumptions?: string[]; allocations?: StockAllocation[] }
export interface DeductionResult {
  rows: DeductionRow[];
  remainingStock: StockMap;
  used: UsedIngredient[];
  issues: Array<{ id: string; message: string }>;
  preservesSourceUnits?: boolean;
}
export interface MeasureInfo { unit: string; factor: number; known: boolean }
export interface StockData { values: StockMap; names: Map<string, string> }
export interface DeductionAPI {
  proposal(input?: DeductionInput): DeductionResult;
  measure(unit: unknown): MeasureInfo;
  stockData(stock: StockMap, id?: CanonicalId): StockData;
}

export type NumericInput = number | string | null;
export type ReceiptUnit = 'g' | 'ml' | 'tsp' | 'tbsp' | 'each' | 'clove' | 'bulb' | 'tin' | 'pack' | 'bag' | 'bunch' | 'loaf' | 'slice';
export interface MeasuredQuantity { quantity: number; unit: ReceiptUnit }
export interface ReceiptPack { packCount: number; packQuantity: number; packUnit: ReceiptUnit }
export type ReceiptSource = 'receipt' | 'uk-default' | 'shopping-list' | 'essential-count';
export interface ReceiptSuggestion extends MeasuredQuantity, Partial<ReceiptPack> {
  source: ReceiptSource;
  estimated: boolean;
  note: string;
  invalid?: false;
}
export interface ReceiptLine {
  name?: string;
  description?: string;
  canonicalKey?: string;
  ingredientKey?: string;
  key?: string;
  classification?: string;
  kind?: string;
  sourceKind?: string;
  selected?: boolean;
  quantity?: NumericInput;
  unit?: string | null;
  packCount?: NumericInput;
  count?: NumericInput;
  packQuantity?: NumericInput;
  packSize?: NumericInput;
  packUnit?: string | null;
  packSizeUnit?: string | null;
  packText?: string;
  packReviewed?: boolean;
}
export interface CatalogueEntry {
  ingredient?: string;
  key?: string;
  canonicalKey?: string;
  standard_pack_size?: NumericInput;
  standard_pack_unit?: string;
  packQuantity?: NumericInput;
  packUnit?: string;
  unit?: string;
  _pair?: string;
}
export type CatalogueRows = CatalogueEntry[] | Record<string, CatalogueEntry>;
export interface CatalogueEnvelope { ingredients: CatalogueRows }
export interface ShoppingQuantity {
  canonicalKey?: string;
  key?: string;
  name?: string;
  quantity?: NumericInput;
  qty?: NumericInput;
  toBuy?: NumericInput;
  required?: NumericInput;
  unit?: string;
}
export interface QuantityContext {
  pantryPolicy?: boolean;
  inventory?: Record<string, Record<string, unknown>>;
  market?: 'UK' | 'Guernsey' | 'Jersey' | 'US';
  choices?: Array<{ key?: string; name?: string; units?: string[] }>;
  shoppingItems?: ShoppingQuantity[];
  catalog?: CatalogueRows | CatalogueEnvelope;
}
export interface ReceiptQuantityAPI {
  infer(line?: ReceiptLine, context?: QuantityContext): ReceiptSuggestion | null;
  measured(quantity: unknown, unit: unknown): MeasuredQuantity | null;
  key(value: unknown): string | null;
}

declare global {
  const module: { exports: unknown };
  interface Window {
    BBPantryPolicy?: typeof import('../bb-pantry-policy');
    BBPantryDeduction?: DeductionAPI;
    BBReceiptQuantity?: ReceiptQuantityAPI;
  }
}
