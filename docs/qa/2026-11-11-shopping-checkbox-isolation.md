# Shopping checkbox interaction and save acknowledgement

The standalone Shop checkbox previously kept its optimistic check after the
underlying purchase transaction rejected a save. A later Buying choice caused
the list to repaint from storage, revealing that those checks had never saved.
A mismatched online/device pantry reproduces this sequence; it is independent
of the display rounding of the 266.666667 g cheddar requirement.

Checkbox click and change events now stop at the checkbox in both Shop views.
Buying buttons, preset chips and editor events stop before row completion
handlers. The standalone checkbox always repaints from the authoritative save
result, including a rejected transaction or detached source input.

If the existing pantry gate requires a saved-stock review, the tick opens the
existing review in Shop. Its existing "Use this device’s amounts" action fills
the saved quantities; no re-entry is required. Confirming uses the unchanged
reviewed compare-and-swap path and retries only the intended purchase after
checking the actor, session and trip again. Cancellation does not buy anything.

Online purchase acknowledgements also preserve the next open Buying editor and
its Custom quantity/total-cost draft. Saving a preset still closes its editor.
The UI script has a new versioned URL for installed clients.

Six new actual-browser cases exercise 320 px and 390 px Shop views, independent
checkbox/preset events, preservation of unrelated purchases, a failed write,
saved-pantry review/retry, delayed online acknowledgements and Finish/reload.
Physical checks include 12 wraps, a 267 g cheddar purchase and a 200 g cream
purchase; Finish never adds them again. The 266.666667 g recipe requirement
remains unchanged. Existing calculations, canonical matching, inventory
subtraction, conversion functions, storage structures and original assertions
are untouched.

All fixture traffic is intercepted locally. Regression fixtures contain only
synthetic data; no account records or credentials are published.
