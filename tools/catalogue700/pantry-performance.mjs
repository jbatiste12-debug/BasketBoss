// Share the controller's existing read-only plan snapshot with its amount
// readouts. Legacy shopping-inventory.js remains byte-for-byte unchanged.
export function transform700PantryPerformance(source){
 if(typeof source!=='string')throw Error('catalogue700_pantry_performance_source');
 const once=(from,to)=>{
  const at=source.indexOf(from);
  if(at<0||source.indexOf(from,at+from.length)>=0)throw Error('catalogue700_pantry_performance_tiles');
  source=source.slice(0,at)+to+source.slice(at+from.length);
 };
 for(const expression of [
  'window.BBHome?.total?.(row.name,coverage.unit)',
  'window.BBHome?.total?.(row.name,actual.unit)',
  'window.BBHome?.total?.(row.name,row.unit)',
  'window.BBHome?.requirement?.(row.name,row.unit)'
 ]){
  const at=source.indexOf(expression);
  if(at<0||source.indexOf(expression,at+expression.length)>=0)throw Error('catalogue700_pantry_performance_readout');
  source=source.slice(0,at)+expression.slice(0,-1)+',{requirements:bb5Requirements()})'+source.slice(at+expression.length);
 }
 // These are separate existing identities: custom-tile display deduplication
 // uses canon(), while selection uses the stricter location-qualified sid().
 // Rebuild both indexes inside every render; never merge or alter stock rows.
 once('  const existing=Object.values(read(INVENTORY));\n  for(const loc of BB5_LOCATIONS){',
  '  const existing=Object.values(read(INVENTORY));\n  const bb700SelectedFoodIds=new Set([...staged.values()].map(row=>sid(row.loc,row.name)));\n  for(const loc of BB5_LOCATIONS){');
 once('   const custom=[...new Map([...existing,...staged.values()].filter(x=>x?.name&&x.loc===loc&&!preset.some(([,n])=>canon(n)===canon(x.name))).map(x=>[canon(x.name),[\'✏️\',x.name]])).values()];',
  '   const bb700PresetNames=new Set(preset.map(([,name])=>canon(name)));\n   const custom=[...new Map([...existing,...staged.values()].filter(x=>x?.name&&x.loc===loc&&!bb700PresetNames.has(canon(x.name))).map(x=>[canon(x.name),[\'✏️\',x.name]])).values()];');
 once('    const on=draftKeys(loc,name).length>0;return ',
  '    const on=bb700SelectedFoodIds.has(sid(loc,name));return ');
 return source;
}
