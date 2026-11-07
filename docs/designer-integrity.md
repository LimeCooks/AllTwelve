# Drawing relationships and complete field view

Deleting an opponent now removes routes anchored to that opponent, just as deleting our own player does. Deleting a route detaches its coverage shapes at their current positions rather than leaving nonexistent route references or deleting the coverage annotations. Applying a formation clears routes attached to the replaced side's players while preserving the other side's routes. Hidden opponent looks also hide opponent-anchored routes and their attached coverage.

Normalization repairs historical dangling references in memory and reconciles route endpoints with their points/player anchors. It does not write back merely because a play was opened. Modern API writes reject missing player/route references and overlapping own/opponent IDs before changing the saved record. Undo snapshots remain unchanged by the model operations.

The Canadian amateur field remains 110×65 yards between goal lines, with 20-yard end zones at each end. The previous Full field option used 140 yards and clipped the far end; it now fits the complete 150-yard footprint. Player/route coordinates and one-yard scale are unchanged. Source: [Football Canada tackle rulebook, Rule 1](https://footballcanada.com/wp-content/uploads/2022/04/2022-Tackle-Rulebook-English-Web.pdf). This is the amateur preset, not a claim about future professional-rule variants.

## Verification

All 24 tests pass. New checks exercise player/route deletion, coverage detachment, own/opponent formation changes, historical orphan repair, invalid reference rejection, full-field camera bounds and actual API save/reopen behavior. An invalid linked update leaves the prior saved play intact.

Browser testing opened the existing defensive diagram, selected Full field and verified the `0 -100 720 1500` viewport with both end zones visible. Deleting the one route left the one coverage shape; Undo restored both. The test draft was discarded without saving, returning to the original saved diagram. No prototype or hosted records were created or modified by that browser check.

Physical-device drawing and authenticated hosted workflows remain separate unverified handoff gates. This does not complete the full designer audit.
