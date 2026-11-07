# Calendar reliability

New events now convert the device's local date/time to UTC with its actual daylight-saving offset. The event dialog names the device time zone. Calendar day grouping and time labels convert saved instants back into that zone; they no longer extract the original stored string's date or hour. Existing records are normalized when read, without rewriting them.

The week view expands its hourly range for morning and late events instead of clamping everything into the original 3–8 PM grid. A failed schedule load shows a retry state before editing is available. A failed create keeps the dialog open with a visible error; pending writes prevent double submission and accidental dialog closure. API validation rejects missing time zones, impossible dates, empty titles, invalid types and non-positive durations. Authentication failures retain their correct status, and records remain team-scoped.

The former Subscribe action is now labelled Export calendar: it downloads a snapshot, not a live subscription. Exported events use UTC DTSTART/DTEND with Z, DTSTAMP, escaped text and UTF-8-safe folded lines. Commas, semicolons, backslashes or newlines in notes cannot turn into malformed calendar properties.

## Evidence

- Automated tests verify Halifax summer/winter conversion, rejection of a skipped daylight-saving time, correct local day near UTC midnight, calendar export instants/text escaping/line folding, API validation, anonymous rejection and cross-owner schedule isolation.
- Local browser testing created a 9:30–10:30 AM event on November 6, reopened it and verified the morning grid range and AM label. The API returned 13:30–14:30 UTC, the correct Atlantic winter instants.
- The exact inspected QA event was removed by its ID/title and the original empty local schedule was verified. No hosted test records were created.

## Remaining limits

Calendar uses the viewing device's time zone; there is no separate team-zone preference yet. Ambiguous repeated daylight-saving times use the browser's default choice. Overnight/multi-day event rendering, overlapping events, event editing, physical-device input and importing the export into the owner's real calendar app still need further work or verification. The API accepts overnight events, but the week grid currently places them on the start day. Availability loading also needs its own explicit failure treatment. These checks do not establish a fully polished calendar handoff.
