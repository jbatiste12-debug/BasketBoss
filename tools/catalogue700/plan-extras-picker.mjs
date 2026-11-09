// Bind the optional dessert picker to the existing private planner transaction.
// Legacy clients retain their original Discover flow; only generated 700 builds opt in.
const ANCHOR="app.querySelectorAll('[data-dessert-add-day]').forEach(el=>el.onclick=()=>{bbDessertTargetDay=el.dataset.dessertAddDay;tab='discover';collectionFilter='Desserts';query='';recipeIndex=0;galleryPage=0;render();notify('Choose a dessert for '+bbDessertTargetDay)});";
const REPLACEMENT=`app.querySelectorAll('[data-dessert-add-day]').forEach(el=>el.onclick=()=>{
 const day=el.dataset.dessertAddDay;
 return window.BBPlanExtras.openDessertPicker({
  win:window,day,eligible:bbIsDessert,
  recipes:()=>RECIPES.filter(recipe=>bbIsDessert(recipe)&&bb176AllowedRecipe(recipe.id)&&!(state.plannedDesserts||[]).some(slot=>slot.recipeId===recipe.id)),
  context:()=>JSON.stringify([window.BBHome?.actor?.()||'guest',localStorage.getItem('basketboss_cloud_session_v1'),state.pantryPlanGeneration,state.plannedDesserts,tab,day,window.BBAccountDeletion?.isDeleting?.()===true]),
  select:(id,chosen)=>{
   if(window.BBAccountDeletion?.isDeleting?.())return false;
   if((state.plannedDesserts||[]).some(slot=>slot.day===chosen)){notify('This day already has a dessert. Remove it before choosing another.');return false;}
   bbPlanDessert(id,chosen);
   return (state.plannedDesserts||[]).some(slot=>slot.recipeId===id&&slot.day===chosen);
  },notify
 });
});`;
export function transform700PlanExtrasPicker(source){
 if(typeof source!=='string'||source.indexOf(ANCHOR)<0||source.indexOf(ANCHOR)!==source.lastIndexOf(ANCHOR))throw Error('catalogue700_plan_extras_picker_anchor');
 return source.replace(ANCHOR,REPLACEMENT);
}
