# Gameplan and practice verification

Gameplanning now loads its saved plan, play library and film observations before allowing edits. A failed or incomplete read produces a retry state, not an editable blank plan. Saves update the visible plan only after the server confirms success. Failed objective/section submissions keep the form open, and concurrent actions are prevented while a save is pending.

Call-sheet selections now store play IDs. Existing unique names resolve to IDs without changing the original saved record; ambiguous or missing names remain visible as unavailable selections and cannot silently select a different play for an install. Renaming a play retains its link. The active plan uses a cadence-neutral storage key; the old prototype key remains a read-only fallback. Practice generation reads the same active plan and respects its unit.

Practice writes return the exact saved plan ID, so duplicate titles and date sorting cannot reopen another plan. Saves and removals update the visible timeline only after confirmation. Load errors offer retry. The API rejects impossible dates, empty titles, invalid segments, and attempts to update/delete another owner's plans. Corrupt stored JSON fails visibly rather than becoming an empty timeline.

## Verification

- Automated tests cover blank and legacy gameplans, failed/malformed reads, name ambiguity, stable links across renames, duplicate practice titles, exact saved IDs, invalid writes preserving prior segments, and owner isolation.
- Local browser testing created a defensive objective and call-sheet section, linked the existing REEEEEE play, generated a 25-minute practice with one defensive segment, and reopened the saved gameplan successfully.
- The pre-test planning values were saved to an ignored local recovery file. Only the verified QA practice was removed, the active plan value was restored, and the original legacy record was compared unchanged. No hosted team or test records were created.

## Still required

Physical-device testing and authenticated hosted workflows remain unverified. Practice refresh now asks before replacing existing segments, including manual additions; browser testing verified the warning and that Keep current segments preserves the manual timeline. The single disposable confirmation test was removed after checking its saved content. Multi-plan gameplanning, complete staff briefs, exact play deep links and linked-film navigation remain further audit work. Current gameplan film observations cover the selected/latest film response, not a complete all-film report dataset.
