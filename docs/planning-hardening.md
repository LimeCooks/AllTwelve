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

## Named gameplans and practice sources — November 8

Gameplans are now independent named records with optional opponent/date and any coaching cadence. Creation, metadata edits, content edits, archive and restore use an owned dedicated API and content revisions. Existing active/legacy planning data appears as Previous gameplan; its original records remain untouched when first saved into the named library. New teams begin with no gameplans. Generic workspace writes cannot bypass these guards.

Practice generation requires an explicitly selected, active saved gameplan revision. The server resolves plays in that team's unit and generates the segments; an unavailable, ambiguous, archived or stale source rejects generation. An atomic source-value check also rejects changes between reading and writing. Practices record the source ID, name and revision at generation. Manual segment edits preserve that history, and regenerating replaces segments only after confirmation. Creation retries with the same ID reopen the existing practice without overwriting later edits.

Plan options, archived plans, film controls/observations and the plan summary start collapsed. Objectives and the call sheet use the main workspace. An arbitrary readiness percentage was removed because it did not establish readiness. Failed content saves retain entered forms and offer an unsaved draft export; explicit reload replaces the editor only after a successful read. Metadata forms retain failed edits and confirm discard.

Automated checks cover independent plans, owner isolation, stale and late-source writes, legacy preservation, archive/restore, retry safety and historical source retention after manual edits. Isolated production-build browser checks created two plans, generated a defensive practice, retained a 12-minute manual edit after cancelling replacement, reopened its exact source, archived/restored the source and recovered from a competing-tab save without overwriting the newer plan. A 390px viewport exposed all practice edit controls without horizontal overflow. Physical-device confirmation and the packaged restart/backup rehearsal are still separate release gates.

This supersedes the single active-plan and unlinked-practice limitations above. Linked-film navigation, complete reports/briefs and the owner's remaining physical-device workflows are still incomplete.

Release verification: the final simplified desktop layout uses 452px-wide objective cards at a 1280px viewport, with film observations and plan summary confirmed closed by default and no horizontal overflow. New-gameplan form controls fit an actual 390px viewport. The packaged production Worker passed isolated restart/backup/team-isolation rehearsal in outputs/release-rehearsal-unmxo8/report.json. The prototype and real hosted workspace were not used for these fixtures.
