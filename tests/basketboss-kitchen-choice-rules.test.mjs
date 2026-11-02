import test from 'node:test';
import assert from 'node:assert/strict';
import {FOOD_PREVIEWS,HOUSEHOLD_PREVIEWS,isHousehold,previewOrder} from '../bb-kitchen-choice-rules.mjs';

test('all four Kitchen previews use real food names or definite household items',()=>{
 for(const foods of Object.values(FOOD_PREVIEWS)){assert.equal(foods.length,4);assert.ok(foods.every(name=>!isHousehold(name)));}
 assert.equal(HOUSEHOLD_PREVIEWS.length,4);
 assert.ok(HOUSEHOLD_PREVIEWS.every(item=>isHousehold(item.name)));
 for(const name of ['Milk','Bread','Eggs','Orange juice','Coffee'])assert.equal(isHousehold(name),false);
 for(const name of ['Toilet rolls','Toothpaste','Laundry detergent','Nappies','Shower gel','Bin bags'])assert.equal(isHousehold(name),true);
});

test('four common choices reorder the same controls without changing the source list or selection',()=>{
 const nodes=['Rice','Salt','Cooking oil','Pasta','Tinned tomatoes'].map((name,index)=>({name,selected:index===1}));
 const ordered=previewOrder(nodes,FOOD_PREVIEWS.cupboard,node=>node.name);
 assert.deepEqual(ordered.slice(0,4).map(node=>node.name),FOOD_PREVIEWS.cupboard);
 assert.equal(ordered[4],nodes[1]);assert.equal(ordered[4].selected,true);
 assert.deepEqual(nodes.map(node=>node.name),['Rice','Salt','Cooking oil','Pasta','Tinned tomatoes']);
 assert.ok(ordered.every(node=>nodes.includes(node)));
});
