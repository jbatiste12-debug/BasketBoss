declare namespace policy {
 type BaseUnit = 'g' | 'ml' | 'each';
 type Status = 'in' | 'low' | 'out' | 'unknown';
 interface Options {market?:string|null;canonicalize?:(name:string)=>string;reviewed?:boolean;packReviewed?:boolean;packQuantity?:unknown;packUnit?:unknown;[key:string]:unknown;}
 interface Amount {quantity:number;unit:BaseUnit;estimated:boolean;assumption:string;packQuantity?:number;packUnit?:BaseUnit;}
 interface Purchase {name?:unknown;canonicalKey?:unknown;key?:unknown;description?:unknown;quantity?:unknown;unit?:unknown;packCount?:unknown;packQuantity?:unknown;packUnit?:unknown;[key:string]:unknown;}
 function canonicalName(name:unknown,canonicalize?:(name:string)=>string):string;
 function isStaple(name:unknown):boolean;
 function containerLabel(name:unknown):'bottle'|'jar'|'unit';
 function defaultPack(name:unknown,unit:unknown,options?:Options):Amount|null;
 function normalize(name:unknown,quantity:unknown,unit:unknown,options?:Options):Amount|null;
 function smallUse(name:unknown,quantity:unknown,unit:unknown):boolean;
 function staplePurchase(input?:Purchase):{quantity:number;unit:'each';label:'bottle'|'jar'|'unit';estimated:boolean;assumption:string}|null;
 function stapleStatus(record:unknown,stock?:unknown):Status;
 function baseUnit(name:unknown):BaseUnit|'staple'|null;
 function cupGrams(name:unknown):{grams:number;estimated:true;assumption:string}|null;
 const cupTable:Readonly<Record<string,number>>;
 const countGrams:Readonly<Record<string,number>>;
}
export = policy;
