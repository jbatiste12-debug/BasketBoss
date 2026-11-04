import deduction = require('../bb-pantry-deduction.js');
import quantity = require('../bb-receipt-quantity.js');
import type {DeductionAPI, ReceiptQuantityAPI, ReceiptUnit, DeductionIssue, StockMap} from '../types/pantry-workflow';

// Check the inferred JavaScript exports against the public contract as well as
// actual call sites. These are compile-only; no second model implementation.
const cook: DeductionAPI = deduction;
const receipt: ReceiptQuantityAPI = quantity;
const stock: StockMap = {'gnocchi|g': 1000, 'milk|ml': 500};
const cooked = deduction.proposal({stock, ingredients: [{key: 'gnocchi', unit: 'g', required: 250}], amounts: [{id: 'gnocchi|g', quantity: .25, unit: 'kg'}]});
const balance: number = cooked.remainingStock['gnocchi|g'];
const issue: DeductionIssue | null = cooked.rows[0].issue;
const required: number | null = cooked.rows[0].required;
const deducted: number = cooked.rows[0].deduct;
const mismatchLabel: string = cooked.issues[0]?.message ?? '';
const usedUnit: string = cooked.used[0]?.unit ?? '';

const suggestion = quantity.infer({canonicalKey: 'gnocchi', description: 'Gnocchi 500 g', quantity: 1, unit: 'pack'}, {market: 'UK', shoppingItems: [{name: 'Gnocchi', quantity: 250, unit: 'g'}], catalog: {ingredients: {'gnocchi|g': {standard_pack_size: 500, standard_pack_unit: 'g'}}}});
if (suggestion) {
  const measured: number = suggestion.quantity;
  const unit: ReceiptUnit = suggestion.unit;
  const estimated: boolean = suggestion.estimated;
  const packCount: number | undefined = suggestion.packCount;
}
quantity.infer({classification: 'essential', name: 'Kitchen roll'}, {market: 'UK'});
quantity.infer({name: 'Milk 1l'}, {market: 'US', catalog: [{ingredient: 'milk', standard_pack_size: 1, standard_pack_unit: 'l'}]});

// Negative contracts ensure the checker really sees typed exports, not `any`.
// @ts-expect-error receipt amounts can be numbers or numeric strings, never flags
quantity.infer({quantity: true});
// @ts-expect-error Cook quantities are normalized numbers or null, never text
deduction.proposal({stock, ingredients: [{key: 'milk', unit: 'ml', required: '250'}]});
// @ts-expect-error pantry stock cannot contain display-unit strings
deduction.proposal({stock: {'milk|ml': '500 ml'}, ingredients: []});
// @ts-expect-error inline Cook edits require a numeric quantity
deduction.proposal({stock, ingredients: [], amounts: [{id: 'gnocchi|g', quantity: '250', unit: 'g'}]});
// @ts-expect-error receipt units are textual labels, not numeric values
quantity.infer({name: 'Milk', quantity: 1, unit: 1000});
// @ts-expect-error a formatted string is not a numeric remaining balance
const invalidBalance: string = balance;
// Fail if a public result ever becomes `any`, which would weaken these checks.
type IsAny<T> = 0 extends (1 & T) ? true : false;
const cookResultIsTyped: false = null as unknown as IsAny<ReturnType<typeof deduction.proposal>>;
const receiptResultIsTyped: false = null as unknown as IsAny<ReturnType<typeof quantity.infer>>;
void [cook, receipt, issue, required, deducted, mismatchLabel, usedUnit, invalidBalance, cookResultIsTyped, receiptResultIsTyped];
