/* Load the shared normalizer before interactive pantry and shopping actions. */
import {normalizePantryState} from './bb-receipt-inventory-core.mjs?v=20261105-business1';
if(typeof window!=='undefined'){window.BBPantryNormalize=normalizePantryState;window.BBPantryLiveSync=true;}
