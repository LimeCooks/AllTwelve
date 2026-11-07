# Designer camera and pointer handling

The designer now has actual 100–600% magnification, Pan field and Fit controls. Zoom changes the SVG viewport, not player sizes or stored drawing coordinates. Existing screen-to-field conversion continues to snap edits to yards at every magnification. Pan moves only the camera; it does not enter undo history or make a play dirty. Changing field depth resets the camera; Fit restores the unpanned full-width view. Field settings starts collapsed.

Drawing drags now track their pointer ID and reject secondary touch pointers. Pointer cancellation/lost capture ends the active operation, retaining the last visible drawing position and its undo entry. The draggable editing palette also tracks its pointer and clears interrupted gestures. Coarse-pointer controls have larger targets, the editing toolbar can wrap, and its expanded properties scroll within a bounded height.

## Evidence

- Camera tests cover the fit view, magnification, pan, goal-line limits, all three field depths, extreme pans and stable clamped offsets.
- Browser layout checks used 390×844 and 820×1180 viewports. Zoom reached 225%, a native drag changed the viewport as expected, and Fit restored `0 350 720 600`. Leaving the editor returned directly to the saved play without an unsaved-change prompt: no play edit was made or saved during camera testing. The original saved diagram was preserved and temporary viewport sizing was reset.
- The complete automated suite has 19 tests, alongside type checking and targeted lint.

These are desktop-browser viewport and pointer checks, not physical iPhone/iPad touch or stylus proof. Pinch-to-zoom is not implemented; use the explicit zoom and Pan controls. Real-device drawing, interrupted multi-touch and palette positioning after an orientation change still need hands-on verification before polished-product handoff.
