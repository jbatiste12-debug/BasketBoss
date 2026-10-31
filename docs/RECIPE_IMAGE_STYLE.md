# BasketBoss recipe pictures: warm, varied and authentic

The user approved a more candid presentation for the new recipe cards: varied camera angles, table settings and cutlery, with serving marks and some partly eaten portions. This updates the earlier uniform 45-degree pilot composition. Ingredient accuracy and the existing export standard remain required.

## Shared visual identity

- Export each new image as 1448×1086 WebP, with the dish centred for the 4:3 card and a useful 1:1 planner crop.
- Use soft natural kitchen daylight, warm neutral colours, believable food texture, natural browning and sauce sheen.
- Use the exact recipe's ingredients, cuts, sauce, garnish, cooking vessel and stated cooked condition. Visible side dishes and garnishes must be listed ingredients.
- Keep the existing unique slug-based image paths. Original recipe IDs and cooking data do not change when a photo changes.
- Use an editorial food-photography appearance. Camera descriptions in prompts describe the intended look, not captured camera metadata.

## Deliberate variation

The latest user direction is rustic and less clean-cut. Use irregular hand-cut pieces, uneven portions, small serving gaps, a few crumbs or cooking marks, and ordinary used crockery, cutlery and pans. Frame from a normal table distance with softly falling rear focus, neutral indirect daylight and restrained contrast. Avoid HDR detail, uniform bright browning, glossy repeated food shapes and perfect cutaways. The private rustic-v4 prompt guide supersedes earlier macro or glamorous-sheen wording while preserving every recipe fact. Review the actual image for naturalness as well as ingredient accuracy and square crops.

Mix overhead views, high oblique views, familiar 45-degree views and lower table-level views. Choose angles that reveal the dish: an overhead view suits a flat pancake or tray, while a lower view can show a bowl or layered serving. Maintain a clear view of the food and enough of each main component to identify the dish.

Vary warm wood, pale neutral table surfaces, cream ceramics and occasional linen within that shared palette. Include cutlery selectively: a spoon resting beside a bowl, a serving spoon in a pan or a fork beside a cut portion. Keep utensil shapes and placement physically plausible.

Mix freshly served dishes with small signs of eating: uneven edges, a missing spoonful, a cut wedge, a few crumbs or a light sauce mark. Some images may show a more substantially eaten portion where the remaining food still communicates the complete dish. The camera angle, props and serving state should vary together rather than repeating one setup across a batch.

Food remains appetising and prepared as specified by its recipe. Keep hands, people, text, logos and watermarks out of frame. Avoid plastic-looking surfaces, CGI gloss and neon colour grading.

## Current pilot comparison

| Pilot | Requested angle | Presentation |
| --- | --- | --- |
| 322: prawn and cannellini skillet | High oblique, about 65° | Serving spoon and a removed scoop, showing natural serving marks |
| 323: black bean tortilla soup | Lower table angle, about 30° | Used spoon, a partly eaten bowl and a few tortilla crumbs |
| 324: pork and cabbage okonomiyaki | Near overhead | A cut, partly eaten wedge, a nearby fork and naturally uneven edges |

The original pilot exports are backed up under the secure staging directory's `generated/style-v1/`. Updated prompts and styling instructions live in `image-briefs-322-324.json` alongside the staged recipe records. Review both card and square crops before approval. The user subsequently approved these cards and authorised the remaining 176. Each later image must use its final recipe brief and pass both card and square-crop review. The private image-worker ledgers retain source paths, hashes and review outcomes.
