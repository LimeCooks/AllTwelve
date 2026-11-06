# Play designer and formations

## Working flow

1. Open the Playbook navigation section. It contains Playbook, Install, Learn, Printouts, Leaderboard, and Formations.
2. In Formations, choose Offence, Defence, or Special teams, then Our team or Opponent/scout. A scout formation requires an opponent name. Package names are optional free text, such as Jumbo or Nascar; the same formation name can have several packages and several opponent-specific versions.
3. Create a formation and draw its actual alignment. Defensive and special teams formations start with the appropriate side, not offensive personnel. Save before leaving.
4. Create a play inside a playbook. Choose a matching team formation and package, or the appropriate side's starting alignment.
5. The designer automatically occupies the full workspace. Details and drawing menus start collapsed. Select a player: its selection ring pulses and its movable properties bar appears. Expand Edit to change label, colour, and symbol. Drag the grip to move the bar out of the way.
6. Choose Route from the player bar, or Tools. Every field click adds a point to that player's route. Finish route completes it. Select a route to change its colour, solid/dashed/dotted/curved style, arrow/bar/no ending, extend it, or drag individual points. Moving the player keeps its route anchored.
7. Tools adds players, oval/circular zones, rectangular zones, triangular zones, or text labels. Zone width/depth are in yards. Colour, opacity, and rotation are editable. Shapes and labels are draggable.
8. Details & looks → Looks selects a saved alignment for the other side. The option names include opponent and package. Its players are copied into the play, so adjustments do not change the source formation. Hide/show retains the copied look. Special teams can face special teams.
9. Ball changes the yard line while editing; all players, opponent players, route points, coverage shapes, and labels shift by the same distance. C is the Canadian centre field spot (55). Zoom offers 30 yards, 60 yards, and the full field.
10. Save and reopen the play. All diagram and teaching data comes from the database. The saved viewer offers a collapsed Add to install menu with explicit draft selection. Published plays remain locked and can be duplicated for revision.

## Measurements and compatibility

Diagram version 2 uses 10 SVG units per yard on both axes. The Canadian playing surface is 65 by 110 yards. Player symbols are approximately 1.7–2 yards across, including line/defensive symbols; this is independent of screen zoom. Movement snaps to a one-yard grid. Short routes therefore remain distinct from player size.

Older drawings are converted for rendering from their former vertical scale. Saving an edited drawing writes version 2. Existing saved positions and teaching content are not replaced automatically.

Formation owner, opponent, package, and drawing metadata use the existing `layout_json` column. A composite storage key preserves the existing database uniqueness rule while allowing the same visible alignment name in different packages and opponent libraries. No database schema migration is required.

## Keyboard

- Select an item, then Delete/Backspace to remove it.
- Select a player, then arrow keys to move one yard and keep its route anchored.
- Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z redoes.
- Escape finishes the current route/tool and clears selection.

## Other workspace entries

- Install uses the hardened named-package workflow.
- Printouts prints selected saved diagrams and teaching notes.
- Learn lists actual published installs. It does not simulate player accounts or quizzes.
- Leaderboard reports actual assigned/completed install reviews. It does not generate sample scores.

Authentication and account-to-athlete linking remain prerequisites for real player completion. Existing published-content protections remain in place.

## Verification

`pnpm test` covers defensive/scout/team formation separation, custom package names, wrong-side rejection, modern route/shape/opponent persistence, uniform ball-spot shifting, duplicate play fidelity, malformed input rejection, and the earlier Install hardening checks. The browser verification additionally exercises actual selection, colours, short route creation, coverage dimensions/rotation, property-panel dragging, defensive formation selection, named opponent selection, save/reopen, player dragging, and undo/redo.
