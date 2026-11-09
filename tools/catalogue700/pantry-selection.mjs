import {transform700PantryPerformance} from './pantry-performance.mjs';
// Bind the existing pantry transaction only in explicitly generated 700 clients.
const ANCHOR=' // One Kitchen picker and one Pantry list. Keep legacy controllers in the DOM';
export function transform700PantrySelection(source){
 if(typeof source!=='string'||source.indexOf(ANCHOR)<0||source.indexOf(ANCHOR)!==source.lastIndexOf(ANCHOR))throw Error('catalogue700_pantry_selection_anchor');
 source=transform700PantryPerformance(source);
 const binding=`
 if(window.BBPantrySelection)window.BBPantrySelection.bind({
  editor:window.BBPantryEditor,
  context:()=>({actor:draftActor(),market:policyMarket(),card}),
  ready:()=>editorGuard()||((saving||draftDirty||movingReduced)?'Finish saving your pantry changes before selecting foods.':''),
  snapshot:()=>({rows:new Map([...staged].map(([key,row])=>[key,{...row}])),targets:new Map([...stagedTargets].map(([key,row])=>[key,{...row}])),dirty:draftDirty,pending:pendingFoodDraft,revision:physicalRevision()}),
  restore:snapshot=>{
   if(draftActor()!==openedActor||!card.isConnected||physicalRevision()!==snapshot.revision)return false;
   staged.clear();for(const [key,row]of snapshot.rows)staged.set(key,row);
   stagedTargets.clear();for(const [key,row]of snapshot.targets)stagedTargets.set(key,row);
   draftDirty=snapshot.dirty;pendingFoodDraft=snapshot.pending;render();editorEvent('selection-rollback');return true;
  },
  committed:keys=>!draftDirty&&keys.every(key=>!staged.has(key)&&read(INVENTORY)[key]?.selected!==true),
  message:()=>note.textContent
 });
`;
 return source.replace(ANCHOR,binding+ANCHOR);
}
