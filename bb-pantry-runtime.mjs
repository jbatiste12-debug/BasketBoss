/* Load the shared normalizer before interactive pantry and shopping actions. */
import {normalizePantryState} from './bb-receipt-inventory-core.mjs';
if(typeof window!=='undefined'){window.BBPantryNormalize=normalizePantryState;window.BBPantryLiveSync=true;}
