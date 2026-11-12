# AllTwelve work goals

## Goal 1 — design and usability

Status is complete for the local desktop, tablet and phone layouts. The reviewed Non-Prod build was promoted to local Prod.

Audit Home, Film Room, Sideline, Athletes, Depth Charts, Playbook, the designer, Formations, Install, Learn, Printouts, Leaderboard, Reports, Gameplanning, Calendar, Practice Plans, Messages and Settings. Include empty, populated, editing, error and dialog states. Check both themes and desktop, tablet and phone layouts.

Acceptance criteria

- A consistent type scale makes primary text readable at normal browser zoom. Controls, table values, labels, help text and status messages remain legible.
- Workspace widths, padding, alignment, borders and spacing follow shared rules. The main coaching tool uses the available screen area.
- Secondary information is expandable. Repeated headings, redundant boxes and filler copy are removed where they hinder the task.
- Dropdowns, inputs, buttons, menus and dialogs share the site theme and support keyboard and touch use.
- Common tasks use direct actions and retain selection and editing context. Saving, reloading and recovering work remain dependable.
- Existing workflows pass regression and integration checks. Browser review covers representative populated states at desktop, tablet and phone sizes before the local Prod handoff.

### First design pass

The shared layout now uses the workspace width and aligns page headers with their tools. Form controls and dialogs use shared type and spacing rules. Film Room shows one upload action before a film is selected, then presents its charting controls with larger cell text and room for notes.

Initial browser scan covered 17 desktop views. Film Room fit at 1920px, 1024px and 390px, and the resized Calendar form saved a disposable event at 390px. The regression suite passed 121 tests. Desktop measurements are in `outputs/design-foundation-audit.json`.

Messages now uses themed option lists for conversation type and recipient. The disposable browser workspace confirmed keyboard selection of Direct conversation and a staff recipient, enabling creation. Selecting the same recipient with a pointer confirmed that the closed field displays the staff member's name.

The populated Film Room now uses a fixed page heading, a secondary filename and a collapsed teaching-notes and timeline section. On a disposable saved video, the charting row fit with the video at 1920×1080 and 1024×900. After compacting the header, the row fit at 390×844 as well, ending at 790px without page-level horizontal overflow. The phone-sized browser saved a one-second clip with a teaching note and showed both after reload.

The roster uses larger table labels and prioritizes name, position, availability and profile access at phone widths. In the populated 390×844 check, all four columns fit without sideways scrolling. Opening the athlete profile showed unit, grade, install progress and the editable staff note. The play library and designer use the shared type scale for card titles, tool labels and detail controls. At the same phone size, a published play could be opened, duplicated and renamed through the details drawer, with Save showing the new title and saved status. The updated build passed all 121 regression tests.

Calendar defaults to a week agenda on phone widths and to the full week grid on larger screens. The three explicit views remain available. A 390×844 browser check opened a saved event from the agenda and reached its edit and export actions. At 1024×900 the full grid showed the same saved event. Practice Plans folds unit totals behind a disclosure and gives the timeline more emphasis. At tablet width a saved plan showed both segments, the disclosure showed its two defence segments, and the read-only preview kept the timeline visible with editing actions removed. All 121 regression tests passed.

Reports uses the themed film dataset menu, with charting coverage and methodology below the matrix in Dataset details. A 1024×900 browser check switched from a saved film to All saved films and verified the populated matrix followed that selection. Gameplanning call-sheet rows open the specific saved play and show the linked clip count alongside its role. The tablet check opened the intended published play directly from the call sheet. The updated build passed the isolated dual-instance integration rehearsal, with results in `outputs/local-pilot-check-dqVeN1/report.json`.

Sideline keeps the recording prominent, shows the film picker for multiple recordings and shows clip actions when clips exist. A populated phone check flagged a saved clip and saved a bench note. Install uses a themed package chooser, exposes Add plays directly on drafts and shows a play chooser for packages with multiple plays. The phone check created a draft and added a saved play on retry after a local connection failure. Install now gives a reload instruction if the local server returns a non-JSON error. The cause of that single connection failure and the new error presentation have not been verified.

Depth Charts gives the board the whole width until a position is selected. At 390×844 the board fit without horizontal page overflow and a saved position adjustment was still present after leaving and reopening the chart. Settings uses clearer section navigation and groups logo and profile-photo management in one disclosure. A 1024×900 light-theme check confirmed all four image cards expand and scanned Home, Film Room, Sideline, Athletes, Depth Charts, Reports, Gameplanning, Calendar, Practice Plans, Messages and Settings for page-level overflow. None exceeded the viewport. The updated build passed all 121 regression tests.

The Playbook library, saved details, Learn and Leaderboard now use shared theme colors. Formations exposes team and scout choices directly. Learn opens the selected published install, and Printouts exposes Saved plays and Practice scripts directly. The phone check opened the exact published package and reached the saved practice PDF preview, including its coaching segment and Prepare PDF control. The tablet check selected Opponent / scout and verified the populated Leaderboard. Type checking, the production build and all 121 regression tests passed.

The saved gameplan, saved practice plan and practice print pickers share the same themed option list. At tablet width the keyboard could clear a selected gameplan. At phone width the practice picker could clear and restore a saved plan, including its timeline. In light theme the practice print menu fit within the 390px viewport and opened the correct preview. Type checking, the build and all 121 regression tests passed.

Play Designer now uses the shared option list for field depth, player symbols, route styles and endings, coverage shapes, play type, and formation selection. At 390×844 keyboard selection changed a saved play to Coverage, Escape closed the menu without closing the details drawer, and Save confirmed the change. A separate pointer check changed the field depth to 30 yards. Type checking, the build and all 121 regression tests passed.

The populated build `9863ea0bf0f7` was scanned across 17 workspace views at 390×844, 1024×900 and 1920×1080 in both themes. All 102 observations loaded the expected screen within the page width. Visible labels, headings, paragraphs and buttons checked by the scan were at least 12px. The visual tablet review exposed dark Film Room surfaces paired with light-theme text and a call-sheet row that squeezed the play name into a 15px column. The next build uses theme colors across the film library, transport and stat sheet and gives the call-sheet row a flexible name column. Recheck those visual fixes on the updated build.

The exact local Non-Prod artifact `9a1a09606615` was loaded with disposable records for visual review. At 1024×900 the Film Room stat sheet, notes disclosure and library had readable light-theme surfaces. The call-sheet play name had 562px at tablet width and 192px at phone width. The isolated integration rehearsal passed again on that artifact (`outputs/local-pilot-check-RlEpLg/report.json`).

Native form selects opt into themed option lists where the browser supports them. On build `730712f6d647`, the 390×844 Calendar test opened the styled picker, selected Travel with the keyboard, saved the event and reopened it with the correct type. The 1024×900 dark-theme test verified the matching picker colors. Older browsers retain their built-in picker.

### Local Prod handoff

The exact reviewed build `730712f6d647` is running on local Non-Prod (3102) and local Prod (3101). The final isolated integration rehearsal passed (`outputs/local-pilot-check-iWZrfc/report.json`), along with all 121 regression tests. After promotion, both sites reported the same build and their original separate database IDs. Opening local Prod as Owner reached blank-team onboarding. Phone and tablet checks used browser viewports on this computer. The local addresses are loopback-only.

### Follow-up review of interactive states

Status is complete. A report from local Prod showed a misaligned Archived checkbox in Playbook settings. The earlier viewport scan did not exercise that dialog. The follow-up reviewed dialog layouts, form controls, editing, confirmations, keyboard access and recovery with disposable records before promotion.

The Playbook settings check on disposable build `16fb9a93f72c` measured an 18px checkbox with a 9px gap to its label. At 390px the keyboard toggled Archived, Save persisted it, and reopening showed the checked state. The disposable playbook was then unarchived. The review also found legacy dark field colors and mobile footer ordering in the shared dialog styles. The follow-up build uses the active theme for form fields, preserves action order as buttons wrap, and leaves space for Close beside long titles. Check those shared changes on long forms and error dialogs before promotion.

On build `d04901a47897`, the light-theme Calendar form at 320×600 scrolled vertically with no horizontal overflow. Saving and reopening a disposable event verified that the footer remained reachable. The removal confirmation fit at that width and Keep event returned to the saved event. Broader dialog and error-state review is pending.

Calendar save errors now appear beside the save action. On build `d8c5ee3f364d` at 320×600 in light theme, an end time before the start produced a visible error without horizontal overflow. Build `52ae37c86f4d` gives Location and the saved-location picker distinct accessible labels and reserves recovery actions for failures that may require them. The 320×600 recheck showed the invalid-time message by itself and confirmed the corrected event retained its location. A two-tab stale-edit test showed the draft download and reload actions, disabled Save, and then loaded the latest title and re-enabled Save after confirmation.

Roster and install dialogs were reviewed on build `61d8d7c7e8d8`. At 320×600 in light theme the long Add athlete form scrolled without sideways overflow, and a saved profile edit updated the jersey number. The removal checkbox was 18px wide with a 9px label gap. Space enabled the destructive action and Cancel kept the athlete. At the same width in dark theme a draft install was created and renamed. Its delete confirmation fit and Cancel preserved the draft.

The 320×600 dark-theme Roster retry showed a visible duplicate-email error next to Save without sideways overflow. Correcting the email kept the entered name and saved the athlete. A stale install edit showed the preserved draft, Download draft and Reload latest install. The recovery panel fit at 320px. Keep draft retained the old input, and the confirmed reload showed the newer saved name. At the same width, the practice PDF preview and its two 18px option checkboxes fit. Space toggled Include coaching notes and removed the note from the preview. The remaining module review and final release verification are pending.

Build `3c7d26c22dc4` applies the destructive style to discard and removal confirmations across Roster, Depth Charts, Calendar, Practice Plans, Gameplanning, Install, Messages, Play Designer and Sideline. At 320×600 in dark theme, Gameplanning focused Keep editing, returned to the typed draft and saved the new plan. Film Room focused Keep film, fit both actions and returned to the saved recording on cancellation. Messages switched to Direct conversation and kept Create disabled before recipient selection. All 121 regression tests passed.

The isolated two-instance rehearsal passed (`outputs/local-pilot-check-JnuRxk/report.json`). The final candidate's light-theme Playbook settings fit at 1280px and 320px. Its 18px checkbox was vertically centered with a 9px gap to the label. Keyboard archive and reopen persisted, then the disposable playbook was unarchived. At 320×600, the Playbook delete confirmation fit and Cancel preserved the playbook. The Depth Charts discard prompt fit, and Keep editing preserved the name through Add position and Save layout. The Practice Plans segment form fit and saved. Sideline preserved a note draft on Keep editing and then saved the note.

Both local sites now run release `3c7d26c22dc4` with their original separate databases. The reported Playbook was opened on local Prod after promotion. Its Archived checkbox was centered beside the label, and the settings description explained renaming and archiving. No Prod record was edited during the check.

## Goal 2 — GitHub build and integration pipeline

Status is queued after the design work. This is a separate deliverable.

Acceptance criteria

- Pull requests run reproducible dependency installation, type checking, regression tests and a production build.
- Integration jobs exercise isolated blank onboarding, team permissions, saved coaching workflows, media ranges, backups, recovery and restart persistence.
- Failures produce actionable logs and retained reports. The exact commit and build under test are recorded.
- Fast pull-request checks and longer release checks have appropriate triggers and timeouts. Fixture storage and credentials are scoped to each run.
- Verify the workflow on GitHub with a real run and a deliberately failing regression case before calling the pipeline complete.

The pipeline will reuse the existing tests and release rehearsal scripts. Browser visual review remains part of the release process.
