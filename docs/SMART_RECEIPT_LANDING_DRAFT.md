# SmartReceipt landing rollout

The reviewed copy is implemented in `welcome.html` under
`data-bb-smart-receipt-ready`. It is hidden in static assets and remains hidden
on production until `receiptInventoryConfigured` passes. The landing Pages
Function reveals it with HTMLRewriter.

It describes receipt review, confirmation, food inventory updates, separate
Weekly Essentials subtotals and next-shop Pantry review. It retains the shared
five-photo daily allowance and explains Google Gemini photo processing.

Apply and verify the Supabase migration before enabling the production flag;
see `RECEIPT_INVENTORY_DEPLOYMENT.md`.
