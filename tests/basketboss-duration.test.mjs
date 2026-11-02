import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),duration=require('../bb-duration.js');

test('recipe totals use compact hour and minute labels',()=>{
 for(const [input,output] of [[0,'0mins'],[1,'1min'],[30,'30mins'],[59,'59mins'],[60,'1hr'],[90,'1hr 30mins'],[120,'2hrs'],[255,'4hrs 15mins'],['90','1hr 30mins']])assert.equal(duration.format(input),output);
 for(const input of [null,undefined,'',true,-1,NaN,Infinity,{},'unknown'])assert.equal(duration.format(input),'?');
});

test('instruction times preserve range endpoints and surrounding directions',()=>{
 assert.equal(duration.text('Bake at 180°C for 90 minutes, until golden.'),'Bake at 180°C for 1hr 30mins, until golden.');
 assert.equal(duration.text('Simmer for 1 hour 30 minutes, then rest for 10 mins.'),'Simmer for 1hr 30mins, then rest for 10mins.');
 assert.equal(duration.text('Cook for 1 hour and 15 minutes.'),'Cook for 1hr 15mins.');
 assert.equal(duration.text('Bake for 90–120 minutes.'),'Bake for 1hr 30mins–2hrs.');
 assert.equal(duration.text('Cook 25 to 30 minutes, then rest 1.5 hours.'),'Cook 25mins to 30mins, then rest 1hr 30mins.');
 assert.equal(duration.text('Add 250 g flour and 500 ml water; cook for 45 seconds.'),'Add 250 g flour and 500 ml water; cook for 45 seconds.');
});

test('display conversion is repeatable and does not mutate recipe records',()=>{
 const recipe={mins:90,method:['Roast for 90 minutes.']},before=JSON.stringify(recipe);
 const label=duration.text(recipe.method[0]);
 assert.equal(duration.text(label),label);
 assert.equal(JSON.stringify(recipe),before);
});

test('optional timers use the first explicit step duration, including long and compound times',()=>{
 for(const [text,seconds]of [['Roast for 1 hour 30 minutes.',5400],['Cook on LOW for 7–8 hours.',25200],['Bake for 255 minutes.',15300],['Stir for 45 seconds.',45],['Rest for 1.5 hours.',5400],['Heat at 200°C for 20–25 minutes, then rest for 10 minutes.',1200],['Add 250 g rice and 500 ml water.',null]])assert.equal(duration.seconds(text),seconds,text);
});
