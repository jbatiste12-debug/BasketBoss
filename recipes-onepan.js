// recipes-onepan.js — 25 One-Pan & Minimal Washing Up
window.ONEPAN_RECIPES = [
  {
    id: 'op_1',
    name: 'One-Pan Creamy Garlic Parmesan Pasta Bake',
    category: 'Italian • Minimal Washing Up',
    styleTag: 'ONE-PAN WONDER',
    styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    isDateNight: false,
    prepTime: 20,
    estCost: 11.20,
    image: 'https://images.unsplash.com/photo-1633964913295-ceb43826e7c9?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Everything cooks in a single deep frying pan.',
    method: ['Sauté chicken and garlic.', 'Add dry pasta, stock, and cream.', 'Simmer 15 mins.', 'Stir in parmesan.'],
    ingredients: [
      { id: 'op1_1', name: 'Chicken Breast (500g)', price: 4.50, category: 'Meat' },
      { id: 'op1_2', name: 'Penne Pasta (500g)', price: 1.10, category: 'Grains' },
      { id: 'op1_3', name: 'Double Cream (300ml)', price: 1.80, category: 'Dairy' },
      { id: 'op1_4', name: 'Parmesan Block', price: 3.80, category: 'Dairy' }
    ]
  },
  {
    id: 'op_2',
    name: 'One-Pan Sausage & Gnocchi Tomato Bake',
    category: 'Midweek Comfort • Family of 6',
    styleTag: 'ONE-PAN WONDER',
    styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    isDateNight: false,
    prepTime: 20,
    estCost: 12.50,
    image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Soft potato gnocchi cooks directly in tomato sauce.',
    method: ['Brown sausages.', 'Add passata and gnocchi.', 'Simmer 10 mins.', 'Top with mozzarella and grill.'],
    ingredients: [
      { id: 'op2_1', name: 'Cumberland Sausages', price: 3.50, category: 'Meat' },
      { id: 'op2_2', name: 'Potato Gnocchi (500g)', price: 1.80, category: 'Grains' },
      { id: 'op2_3', name: 'Passata (500g)', price: 1.30, category: 'Vegetables' },
      { id: 'op2_4', name: 'Mozzarella Ball', price: 2.40, category: 'Dairy' },
      { id: 'op2_5', name: 'Garlic Baguette', price: 3.50, category: 'Bakery' }
    ]
  },
  {
    id: 'op_3',
    name: 'One-Pan Spanish Chorizo & Rice Skillet',
    category: 'Mediterranean • Family Dinner',
    styleTag: 'ONE-PAN WONDER',
    styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    isDateNight: false,
    prepTime: 25,
    estCost: 13.20,
    image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Chorizo releases spiced red oil to flavor the rice.',
    method: ['Slice chorizo and fry.', 'Stir in rice, stock, and peppers.', 'Simmer 20 mins.'],
    ingredients: [
      { id: 'op3_1', name: 'Spanish Chorizo Ring', price: 2.80, category: 'Meat' },
      { id: 'op3_2', name: 'Chicken Breast (500g)', price: 4.50, category: 'Meat' },
      { id: 'op3_3', name: 'Long Grain Rice (1kg)', price: 1.80, category: 'Grains' },
      { id: 'op3_4', name: 'Bell Peppers & Stock', price: 4.10, category: 'Vegetables' }
    ]
  },
  {
    id: 'op_4',
    name: 'One-Pan Creamy Tuscan Garlic Chicken',
    category: 'Italian Style • Family Meal',
    styleTag: 'ONE-PAN WONDER',
    styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    isDateNight: false,
    prepTime: 20,
    estCost: 14.10,
    image: 'https://images.unsplash.com/photo-1604908176997-125f2596f3ed?auto=format&fit=crop&w=800&q=80',
    familyTip: 'Sun-dried tomatoes and spinach make a rich sauce.',
    method: ['Sear chicken.', 'Fry garlic, tomatoes, and cream in pan.', 'Simmer chicken in sauce.'],
    ingredients: [
      { id: 'op4_1', name: 'Chicken Breast (1kg)', price: 8.50, category: 'Meat' },
      { id: 'op4_2', name: 'Cream & Tomatoes', price: 3.50, category: 'Dairy' },
      { id: 'op4_3', name: 'Baby Spinach', price: 1.60, category: 'Vegetables' },
      { id: 'op4_4', name: 'Crusty Loaf', price: 1.50, category: 'Bakery' }
    ]
  },
  { id: 'op_5', name: 'One-Pan Beef Stroganoff', category: 'Comfort Food', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 25, estCost: 14.00, image: 'https://images.unsplash.com/photo-1633964913295-ceb43826e7c9?auto=format&fit=crop&w=800&q=80', familyTip: 'Tender beef strips in creamy mushroom sauce.', method: ['Sauté beef and mushrooms with sour cream.'], ingredients: [{ id: 'op5_1', name: 'Beef Strips & Mushrooms', price: 14.00, category: 'Meat' }] },
  { id: 'op_6', name: 'One-Pan Lemon Herb Salmon & Asparagus', category: 'Healthy Skillet', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 15, estCost: 15.00, image: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=800&q=80', familyTip: 'Pan-seared salmon with fresh lemon.', method: ['Pan-fry salmon and asparagus together.'], ingredients: [{ id: 'op6_1', name: 'Salmon & Asparagus', price: 15.00, category: 'Meat' }] },
  { id: 'op_7', name: 'One-Pan Mexican Beef Rice', category: 'One-Pot Meal', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 25, estCost: 11.50, image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80', familyTip: 'Spiced beef, beans, and rice cooked in one skillet.', method: ['Simmer beef, beans, rice, and tomatoes.'], ingredients: [{ id: 'op7_1', name: 'Mince, Beans & Rice', price: 11.50, category: 'Meat' }] },
  { id: 'op_8', name: 'One-Pan Pork Chops in Mushroom Sauce', category: 'Hearty Skillet', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 25, estCost: 13.00, image: 'https://images.unsplash.com/photo-1514944298352-f4d732111d18?auto=format&fit=crop&w=800&q=80', familyTip: 'Pork chops simmered in savory gravy.', method: ['Sear chops, add mushrooms and stock.'], ingredients: [{ id: 'op8_1', name: 'Pork Chops & Mushrooms', price: 13.00, category: 'Meat' }] },
  { id: 'op_9', name: 'One-Pan Creamy Pesto Chicken Pasta', category: 'Quick Pasta', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 12.00, image: 'https://images.unsplash.com/photo-1633964913295-ceb43826e7c9?auto=format&fit=crop&w=800&q=80', familyTip: 'Pesto and cream pasta with chicken.', method: ['Cook pasta and chicken in pan with pesto.'], ingredients: [{ id: 'op9_1', name: 'Chicken & Pesto', price: 12.00, category: 'Meat' }] },
  { id: 'op_10', name: 'One-Pan Beef & Broccoli Stir-Fry', category: 'Quick Wok', styleTag: '15-MIN QUICK FIX', styleTagColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40', isDateNight: false, prepTime: 15, estCost: 13.50, image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80', familyTip: 'Beef strips and broccoli in savory soy sauce.', method: ['Wok fry beef and broccoli.'], ingredients: [{ id: 'op10_1', name: 'Beef Strips & Broccoli', price: 13.50, category: 'Meat' }] },
  { id: 'op_11', name: 'One-Pan Garlic Butter Shrimp Rice', category: 'Seafood Skillet', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 14.50, image: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=800&q=80', familyTip: 'Juicy shrimp in garlic butter over rice.', method: ['Sauté shrimp in garlic butter.'], ingredients: [{ id: 'op11_1', name: 'Shrimp & Rice', price: 14.50, category: 'Meat' }] },
  { id: 'op_12', name: 'One-Pan Cheesy Beefaroni', category: 'Kid Favorite', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 11.00, image: 'https://images.unsplash.com/photo-1633964913295-ceb43826e7c9?auto=format&fit=crop&w=800&q=80', familyTip: 'Macaroni and beef in cheesy tomato sauce.', method: ['Simmer pasta, mince, and cheese together.'], ingredients: [{ id: 'op12_1', name: 'Macaroni & Mince', price: 11.00, category: 'Grains' }] },
  { id: 'op_13', name: 'One-Pan Chicken Fajita Skillet', category: 'Mexican Skillet', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 13.00, image: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=800&q=80', familyTip: 'Fajita chicken and peppers in one skillet.', method: ['Sauté chicken strips and peppers.'], ingredients: [{ id: 'op13_1', name: 'Chicken & Peppers', price: 13.00, category: 'Meat' }] },
  { id: 'op_14', name: 'One-Pan Creamy Mustard Pork', category: 'Hearty Skillet', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 12.50, image: 'https://images.unsplash.com/photo-1514944298352-f4d732111d18?auto=format&fit=crop&w=800&q=80', familyTip: 'Pork medallions in creamy mustard sauce.', method: ['Pan-fry pork with cream and mustard.'], ingredients: [{ id: 'op14_1', name: 'Pork & Mustard', price: 12.50, category: 'Meat' }] },
  { id: 'op_15', name: 'One-Pan Tomato Basil Gnocchi', category: 'Quick Italian', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 15, estCost: 9.50, image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80', familyTip: 'Gnocchi in rich tomato basil sauce.', method: ['Simmer gnocchi in tomato passata.'], ingredients: [{ id: 'op15_1', name: 'Gnocchi & Passata', price: 9.50, category: 'Grains' }] },
  { id: 'op_16', name: 'One-Pan Ground Turkey Hash', category: 'Healthy Skillet', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 11.50, image: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=800&q=80', familyTip: 'Turkey mince and potato hash.', method: ['Brown turkey and diced potatoes in pan.'], ingredients: [{ id: 'op16_1', name: 'Turkey Mince & Potatoes', price: 11.50, category: 'Meat' }] },
  { id: 'op_17', name: 'One-Pan Teriyaki Chicken Noodles', category: 'Asian Skillet', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 12.00, image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80', familyTip: 'Chicken and noodles tossed in teriyaki.', method: ['Toss chicken, noodles, and teriyaki sauce.'], ingredients: [{ id: 'op17_1', name: 'Chicken & Noodles', price: 12.00, category: 'Meat' }] },
  { id: 'op_18', name: 'One-Pan Creamy Garlic Mushroom Risotto', category: 'Italian Rice', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 30, estCost: 11.00, image: 'https://images.unsplash.com/photo-1633964913295-ceb43826e7c9?auto=format&fit=crop&w=800&q=80', familyTip: 'Rich mushroom risotto.', method: ['Stir broth into arborio rice gradually.'], ingredients: [{ id: 'op18_1', name: 'Arborio Rice & Mushrooms', price: 11.00, category: 'Grains' }] },
  { id: 'op_19', name: 'One-Pan Bacon & Cabbage Pasta', category: 'Irish Comfort', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 15, estCost: 9.00, image: 'https://images.unsplash.com/photo-1633964913295-ceb43826e7c9?auto=format&fit=crop&w=800&q=80', familyTip: 'Crispy bacon and tender cabbage with pasta.', method: ['Toss bacon, cabbage, and pasta with butter.'], ingredients: [{ id: 'op19_1', name: 'Bacon & Cabbage', price: 9.00, category: 'Meat' }] },
  { id: 'op_20', name: 'One-Pan Spicy Cajun Chicken Skillet', category: 'Cajun Spice', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 12.50, image: 'https://images.unsplash.com/photo-1604908176997-125f2596f3ed?auto=format&fit=crop&w=800&q=80', familyTip: 'Bold Cajun spiced chicken and peppers.', method: ['Pan-sear chicken with Cajun spices.'], ingredients: [{ id: 'op20_1', name: 'Chicken & Cajun Spice', price: 12.50, category: 'Meat' }] },
  { id: 'op_21', name: 'One-Pan Beef & Pea Fried Rice', category: 'Quick Rice', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 15, estCost: 11.00, image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80', familyTip: 'Beef mince and peas fried with rice and egg.', method: ['Stir-fry cooked rice with beef and peas.'], ingredients: [{ id: 'op21_1', name: 'Mince, Rice & Peas', price: 11.00, category: 'Meat' }] },
  { id: 'op_22', name: 'One-Pan Cheesy Broccoli Chicken Skillet', category: 'Low Carb Skillet', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 13.00, image: 'https://images.unsplash.com/photo-1604908176997-125f2596f3ed?auto=format&fit=crop&w=800&q=80', familyTip: 'Chicken and broccoli smothered in melted cheddar.', method: ['Sauté chicken and broccoli, melt cheese on top.'], ingredients: [{ id: 'op22_1', name: 'Chicken, Broccoli & Cheese', price: 13.00, category: 'Meat' }] },
  { id: 'op_23', name: 'One-Pan Creamy Sun-Dried Tomato Pork', category: 'Gourmet Skillet', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 14.00, image: 'https://images.unsplash.com/photo-1514944298352-f4d732111d18?auto=format&fit=crop&w=800&q=80', familyTip: 'Pork in sun-dried tomato cream.', method: ['Simmer pork in sun-dried tomato cream sauce.'], ingredients: [{ id: 'op23_1', name: 'Pork & Sun-Dried Tomatoes', price: 14.00, category: 'Meat' }] },
  { id: 'op_24', name: 'One-Pan Sweet & Sour Chicken', category: 'Fakeaway Skillet', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 20, estCost: 12.50, image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80', familyTip: 'Classic sweet and sour chicken with peppers.', method: ['Toss chicken and peppers in sweet and sour sauce.'], ingredients: [{ id: 'op24_1', name: 'Chicken & Sweet & Sour', price: 12.50, category: 'Meat' }] },
  { id: 'op_25', name: 'One-Pan Garlic Butter Steak Bites', category: 'Steak Skillet', styleTag: 'ONE-PAN WONDER', styleTagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDateNight: false, prepTime: 15, estCost: 16.00, image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80', familyTip: 'Tender steak cubes seared in garlic herb butter.', method: ['Sear steak cubes in skillet with garlic butter.'], ingredients: [{ id: 'op25_1', name: 'Steak Cubes & Butter', price: 16.00, category: 'Meat' }] }
];
