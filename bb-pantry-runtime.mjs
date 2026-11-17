/* Load the shared normalizer before interactive pantry and shopping actions. */
import * as receiptCore from './bb-receipt-inventory-core.mjs?v=20261105-business1';
if(typeof window!=='undefined'){
 // The editor already accepts this shared namespace. Reuse the module loaded
 // here so its first opening need not yield another dynamic-import task and
 // briefly paint the retired cupboard view before the current UI is mounted.
 if(!window.BBReceiptInventoryCore)window.BBReceiptInventoryCore=receiptCore;
 window.BBPantryNormalize=receiptCore.normalizePantryState;window.BBPantryLiveSync=true;
}
