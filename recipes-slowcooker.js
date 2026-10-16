// recipes-slowcooker.js — 25 Slow Cooker & Batch Cook Favorites
window.SLOWCOOKER_RECIPES = [
  {
    id: 'sc_1',
    name: 'Smoky BBQ Pulled Pork Buns & Slaw',
    category: 'Slow Cooker • Family Feast',
    styleTag: 'TRAYBAKE & ROAST',
    styleTagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    isDateNight: false,
    prepTime: 15,
    estCost: 14.50,
    image: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Put pork shoulder in the slow cooker in the morning; shred effortlessly by dinner time.',
    method: ['Place pork in slow cooker with BBQ sauce.', 'Cook on low 7-8 hours.', 'Shred with forks and serve in brioche buns.'],
    ingredients: [
      { id: 'sc1_1', name: 'Pork Shoulder Joint (1.2kg)', price: 7.50, category: 'Meat' },
      { id: 'sc1_2', name: 'Brioche Buns', price: 2.20, category: 'Bakery' },
      { id: 'sc1_3', name: 'Coleslaw & BBQ Sauce', price: 4.80, category: 'Vegetables' }
    ]
  },
  {
    id: 'sc_2',
    name: 'Hearty Beef & Three Bean Chilli Bowl',
    category: 'Batch Cook • Zero Waste',
    styleTag: 'ONE-PAN WONDER',
    styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    isDateNight: false,
    prepTime: 25,
    estCost: 14.30,
    image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Batch cook this hearty chilli; leftovers taste even better the next day.',
    method: ['Brown beef mince with onions.', 'Add spices, tomatoes, and beans.', 'Simmer low 25 mins.'],
    ingredients: [
      { id: 'sc2_1', name: '5% Lean Beef Mince (750g)', price: 7.20, category: 'Meat' },
      { id: 'sc2_2', name: 'Mixed Beans & Tomatoes', price: 3.50, category: 'Vegetables' },
      { id: 'sc2_3', name: 'Long Grain Rice (1kg)', price: 3.60, category: 'Grains' }
    ]
  },
  {
    id: 'sc_3',
    name: 'Slow Cooker Honey Garlic Chicken Thighs',
    category: 'Slow Cooker • Easy Dinner',
    styleTag: 'KID-APPROVED FAVORITE',
    styleTagColor: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
    isDateNight: false,
    prepTime: 10,
    estCost: 11.80,
    image: 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Chicken thighs stay super juicy in the slow cooker.',
    method: ['Place chicken thighs in slow cooker.', 'Pour over honey garlic glaze.', 'Cook on high 4 hours.'],
    ingredients: [
      { id: 'sc3_1', name: 'Chicken Thighs (1kg)', price: 6.50, category: 'Meat' },
      { id: 'sc3_2', name: 'Honey & Soy Sauce', price: 3.00, category: 'Grains' },
      { id: 'sc3_3', name: 'Basmati Rice', price: 2.30, category: 'Grains' }
    ]
  },
  { id: 'sc_4', name: 'Slow Cooker Beef Pot Roast & Veg', category: 'Sunday Roast', styleTag: 'TRAYBAKE & ROAST', styleTagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40', isDateNight: false, prepTime: 20, estCost: 15.00, image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80', familyTip: 'Tender roast beef with carrots and potatoes.', method: ['Slow cook beef joint with carrots, potatoes, and beef broth.'], ingredients: [{ id: 'sc4_1', name: 'Beef Roasting Joint & Veg', price: 15.00, category: 'Meat' }] },
  { id: 'sc_5', name: 'Slow Cooker Creamy Chicken Curry', category: 'Curry Night', styleTag: 'FAMILY FAVORITE', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 15, estCost: 13.00, image: 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=800&q=80', familyTip: 'Creamy coconut curry cooked all day.', method: ['Slow cook chicken with curry sauce and coconut milk.'], ingredients: [{ id: 'sc5_1', name: 'Chicken & Curry Sauce', price: 13.00, category: 'Meat' }] },
  { id: 'sc_6', name: 'Slow Cooker Sweet & Sour Pork', category: 'Fakeaway Slow Cooker', styleTag: 'FAMILY FAVORITE', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 13.50, image: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=800&q=80', familyTip: 'Tender pork shoulder chunks in sweet and sour sauce.', method: ['Slow cook pork with peppers, pineapple, and sweet and sour sauce.'], ingredients: [{ id: 'sc6_1', name: 'Pork Shoulder & Sauce', price: 13.50, category: 'Meat' }] },
  { id: 'sc_7', name: 'Slow Cooker Beef Brisket & Gravy', category: 'Hearty Slow Cooker', styleTag: 'TRAYBAKE & ROAST', styleTagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40', isDateNight: false, prepTime: 20, estCost: 16.00, image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80', familyTip: 'Melt-in-the-mouth brisket.', method: ['Slow cook brisket with onions and rich gravy for 8 hours.'], ingredients: [{ id: 'sc7_1', name: 'Beef Brisket Joint', price: 16.00, category: 'Meat' }] },
  { id: 'sc_8', name: 'Slow Cooker French Onion Soup', category: 'Soup Night', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 25, estCost: 10.00, image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80', familyTip: 'Caramelized onions in rich broth topped with cheesy bread.', method: ['Slow cook sliced onions in beef broth 10 hours, top with cheesy bread.'], ingredients: [{ id: 'sc8_1', name: 'Onions, Broth & Bread', price: 10.00, category: 'Vegetables' }] },
  { id: 'sc_9', name: 'Slow Cooker BBQ Meatballs', category: 'Party Slow Cooker', styleTag: 'KID-APPROVED FAVORITE', styleTagColor: 'bg-teal-500/20 text-teal-300 border-teal-500/40', isDateNight: false, prepTime: 10, estCost: 12.00, image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80', familyTip: 'Meatballs swimming in sticky BBQ sauce.', method: ['Slow cook frozen or fresh meatballs in BBQ sauce 4 hours.'], ingredients: [{ id: 'sc9_1', name: 'Meatballs & BBQ Sauce', price: 12.00, category: 'Meat' }] },
  { id: 'sc_10', name: 'Slow Cooker Beef Stroganoff', category: 'Creamy Beef', styleTag: 'FAMILY FAVORITE', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 14.50, image: 'https://images.unsplash.com/photo-1633964913295-ceb43826e7c9?auto=format&fit=crop&w=800&q=80', familyTip: 'Tender beef strips and mushrooms cooked slow.', method: ['Slow cook beef and mushrooms, stir in sour cream at end.'], ingredients: [{ id: 'sc10_1', name: 'Beef Strips & Mushrooms', price: 14.50, category: 'Meat' }] },
  { id: 'sc_11', name: 'Slow Cooker Mexican Chicken Tortilla Soup', category: 'Soup Night', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 12.00, image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80', familyTip: 'Spicy chicken soup topped with tortilla chips.', method: ['Slow cook chicken, tomatoes, corn, and spices.'], ingredients: [{ id: 'sc11_1', name: 'Chicken & Tortillas', price: 12.00, category: 'Meat' }] },
  { id: 'sc_12', name: 'Slow Cooker Sausage Casserole', category: 'Comfort Casserole', styleTag: 'FAMILY FAVORITE', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 11.50, image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80', familyTip: 'Sausages and beans in rich tomato sauce.', method: ['Slow cook sausages, beans, and root veg in tomato broth.'], ingredients: [{ id: 'sc12_1', name: 'Sausages & Veg', price: 11.50, category: 'Meat' }] },
  { id: 'sc_13', name: 'Slow Cooker Whole Lemon Herb Chicken', category: 'Sunday Roast', styleTag: 'TRAYBAKE & ROAST', styleTagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40', isDateNight: false, prepTime: 15, estCost: 13.00, image: 'https://images.unsplash.com/photo-1514944298352-f4d732111d18?auto=format&fit=crop&w=800&q=80', familyTip: 'Incredible tender whole chicken from the slow cooker.', method: ['Place whole chicken in slow cooker with lemon and herbs.'], ingredients: [{ id: 'sc13_1', name: 'Whole Chicken', price: 13.00, category: 'Meat' }] },
  { id: 'sc_14', name: 'Slow Cooker Teriyaki Beef Brisket', category: 'Asian Slow Cooker', styleTag: 'FAMILY FAVORITE', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 16.50, image: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=800&q=80', familyTip: 'Brisket slow cooked in sticky teriyaki glaze.', method: ['Slow cook beef brisket in teriyaki sauce and ginger.'], ingredients: [{ id: 'sc14_1', name: 'Brisket & Teriyaki', price: 16.50, category: 'Meat' }] },
  { id: 'sc_15', name: 'Slow Cooker Lentil & Vegetable Dahl', category: 'Vegetarian Dahl', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 15, estCost: 9.00, image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80', familyTip: 'Spiced red lentils and coconut milk.', method: ['Slow cook lentils, coconut milk, and spices 6 hours.'], ingredients: [{ id: 'sc15_1', name: 'Lentils & Coconut Milk', price: 9.00, category: 'Grains' }] },
  { id: 'sc_16', name: 'Slow Cooker Beef Ragu & Pappardelle', category: 'Italian Ragu', styleTag: 'FAMILY FAVORITE', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 30, estCost: 15.00, image: 'https://images.unsplash.com/photo-1633964913295-ceb43826e7c9?auto=format&fit=crop&w=800&q=80', familyTip: 'Shredded beef ragu over wide pappardelle pasta.', method: ['Slow cook chuck beef in wine and tomatoes, shred over pasta.'], ingredients: [{ id: 'sc16_1', name: 'Chuck Beef & Pappardelle', price: 15.00, category: 'Meat' }] },
  { id: 'sc_17', name: 'Slow Cooker Spare Ribs in Sticky Plum Sauce', category: 'Rib Night', styleTag: 'TRAYBAKE & ROAST', styleTagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40', isDateNight: false, prepTime: 20, estCost: 15.50, image: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=800&q=80', familyTip: 'Fall-apart ribs in plum glaze.', method: ['Slow cook pork ribs in plum sauce and soy.'], ingredients: [{ id: 'sc17_1', name: 'Pork Ribs & Plum Sauce', price: 15.50, category: 'Meat' }] },
  { id: 'sc_18', name: 'Slow Cooker Tuscan Chicken Soup', category: 'Soup Night', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 12.50, image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80', familyTip: 'Chicken, white beans, and kale soup.', method: ['Slow cook chicken, beans, garlic, and broth.'], ingredients: [{ id: 'sc18_1', name: 'Chicken, Beans & Kale', price: 12.50, category: 'Meat' }] },
  { id: 'sc_19', name: 'Slow Cooker Creamy Potato Soup', category: 'Comfort Soup', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 9.50, image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80', familyTip: 'Loaded potato soup with cheese and bacon.', method: ['Slow cook potatoes, broth, cream, and top with bacon.'], ingredients: [{ id: 'sc19_1', name: 'Potatoes, Cream & Bacon', price: 9.50, category: 'Vegetables' }] },
  { id: 'sc_20', name: 'Slow Cooker Butter Chicken', category: 'Indian Slow Cooker', styleTag: 'FAMILY FAVORITE', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 14.00, image: 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=800&q=80', familyTip: 'Classic butter chicken made effortless.', method: ['Slow cook chicken with butter chicken sauce.'], ingredients: [{ id: 'sc20_1', name: 'Chicken & Butter Sauce', price: 14.00, category: 'Meat' }] },
  { id: 'sc_21', name: 'Slow Cooker Sweet Potato & Black Bean Chili', category: 'Vegetarian Chili', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 10.00, image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80', familyTip: 'Sweet potato and black bean chili.', method: ['Slow cook sweet potatoes, black beans, and tomatoes.'], ingredients: [{ id: 'sc21_1', name: 'Sweet Potatoes & Beans', price: 10.00, category: 'Vegetables' }] },
  { id: 'sc_22', name: 'Slow Cooker Apple Pulled Pork', category: 'Apple Pork', styleTag: 'TRAYBAKE & ROAST', styleTagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40', isDateNight: false, prepTime: 15, estCost: 14.00, image: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=800&q=80', familyTip: 'Pork shoulder slow cooked with apples and cider.', method: ['Slow cook pork with chopped apples and cider.'], ingredients: [{ id: 'sc22_1', name: 'Pork & Apples', price: 14.00, category: 'Meat' }] },
  { id: 'sc_23', name: 'Slow Cooker Beef Massaman Curry', category: 'Thai Slow Cooker', styleTag: 'FAMILY FAVORITE', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 25, estCost: 15.50, image: 'https://images.unsplash.com/photo-1604908176997-125f2596f3ed?auto=format&fit=crop&w=800&q=80', familyTip: 'Tender beef and potatoes in Massaman curry.', method: ['Slow cook beef, potatoes, and Massaman paste in coconut milk.'], ingredients: [{ id: 'sc23_1', name: 'Beef & Massaman Paste', price: 15.50, category: 'Meat' }] },
  { id: 'sc_24', name: 'Slow Cooker Corned Beef Hash', category: 'Traditional Hash', styleTag: 'FAMILY FAVORITE', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 11.00, image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80', familyTip: 'Corned beef and potatoes slow cooked to perfection.', method: ['Slow cook corned beef and diced potatoes.'], ingredients: [{ id: 'sc24_1', name: 'Corned Beef & Potatoes', price: 11.00, category: 'Meat' }] },
  { id: 'sc_25', name: 'Slow Cooker Chicken & Dumplings', category: 'Comfort Stew', styleTag: 'FAMILY FAVORITE', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 25, estCost: 12.50, image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80', familyTip: 'Chicken stew with fluffy herb dumplings.', method: ['Slow cook chicken stew, add biscuit dough dumplings at end.'], ingredients: [{ id: 'sc25_1', name: 'Chicken & Dumplings', price: 12.50, category: 'Meat' }] }
];
