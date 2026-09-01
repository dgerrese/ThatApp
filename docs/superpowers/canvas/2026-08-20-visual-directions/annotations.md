# Visual Directions — the canvas annotations

The 27 notes pinned beside the artboards, in canvas order. They carry the *reasoning*
for each board — which is the part no screenshot preserves. Extracted verbatim; not edited,
not summarised. `canvas.json` holds their coordinates.

## Artboards

| Board | File | Size |
| --- | --- | --- |
| Baseline — as it ships | `Main.dc.html` | 1100×940 |
| R1 · The list (today) | `RailList.dc.html` | 216×620 |
| M1 · Row opens in place | `ManualExpand.dc.html` | 880×560 |
| S1 · First run | `StateFirstRun.dc.html` | 1100×940 |
| P1 · Ink primary | `PaletteInk.dc.html` | 880×640 |
| R2 · Health strip | `RailStrip.dc.html` | 216×620 |
| R3 · Where the day went | `RailSplit.dc.html` | 216×620 |
| R4 · Silent unless broken | `RailSilent.dc.html` | 484×620 |
| M2 · Popover | `ManualPopover.dc.html` | 880×660 |
| P2 · Magenta primary | `PaletteMagenta.dc.html` | 880×640 |
| S2 · Loading | `StateLoading.dc.html` | 1100×940 |
| A · Paper | `Paper.dc.html` | 1100×940 |
| R3a · Split + total row | `RailSplitTotal.dc.html` | 216×620 |
| R3b · Total heads the split | `RailSplitMerged.dc.html` | 216×620 |
| M3 · Type into the row | `ManualQuick.dc.html` | 880×300 |
| P3 · Vermillion primary | `PaletteVermillion.dc.html` | 880×640 |
| S3 · Nothing logged | `StateNothingLogged.dc.html` | 1100×940 |
| B · Rail | `Rail.dc.html` | 1100×940 |
| S4 · All pushed | `StateAllPushed.dc.html` | 1100×940 |
| C · Focus | `Focus.dc.html` | 1100×940 |
| S5 · Partial failure | `StatePartialFailure.dc.html` | 1100×940 |
| Mobile · Today | `Mobile.dc.html` | 390×844 |
| M4 · Dialog (desktop) | `ManualDialog.dc.html` | 1100×940 |
| M4 · Sheet (phone) | `MobileSheet.dc.html` | 390×844 |
| D · Hybrid — B's rail, C's character, A's cards | `Hybrid.dc.html` | 1100×940 |

## Notes

### THE SPLIT YOU ASKED FOR
<sub>`id: pal-why`</sub>

Vermillion was doing two jobs — brand AND state — which is exactly why failure had to borrow a triangle instead of a colour.

All three options below split the same way and keep the same state ramp:

RUNNING — green 150, the live timer only
NOT PUSHED — amber 85, entries still local
FAILED — red 25, Jira rejected it
INSTANCES — 265 and 175, identity, never state

CHOSEN: P2, magenta 330. It is applied across every board on the other pages — P1 and P3 stay here as the record of the choice.

Each board shows the same four rows and the three entry chips, so the states sit side by side. Flip the Mode chip — the rail keeps lighter variants of each tone so they hold up on the dark ground.

### P1 · INK PRIMARY
<sub>`id: p1`</sub>

The primary carries no hue at all — near-black on light, near-white on dark, white on the rail. Every colour on screen then means something: green is running, amber is pending, red is failed.

It also echoes where you started: the shipped app's --color-accent is already ink.

COST: no brand colour. The character has to come from the type and the dark rail, which it largely already does.

### P2 · MAGENTA PRIMARY — CHOSEN
<sub>`id: p2`</sub>

Hue 330 — 55 degrees from failed, and clear of both instance hues (265, 175) and of running (150) and pending (85). Nothing on screen can be mistaken for anything else.

Now live on all 16 design boards. The roles it split apart:

PRIMARY magenta — wordmark, Push, links, focus rings
RUNNING green — the live timer and its stop button
PENDING amber — entries still local
FAILED red — the retry banner, failed chips, unreachable instances

Each has a lighter -rail variant for the dark ground, and those are used ONLY inside the rail or the mobile header.

### P3 · VERMILLION STAYS PRIMARY
<sub>`id: p3`</sub>

Keeps exactly the look you approved. The Push button and wordmark stay as they are, and failure takes red 25.

COST, AND IT IS THE REASON I RANK IT LAST: primary 30 and failed 25 are five degrees apart. Look at the Push button next to the Retry button on this board — they are nearly the same colour, which is the exact confusion the split was meant to remove.

### WHY THIS IS NOT JUST AN INPUT
<sub>`id: m-why`</sub>

time_entries has no uniqueness on (instance, issue, day) — a ticket holds SEVERAL entries in a day, each with its own started_at, comment and push state. The 02:30 on a row is a sum.

So typing over 02:30 has no defined meaning: which of the two entries did you just change? And ticket 10 (Edit after push) has to reach individual entries to update or delete their worklogs by id.

Whatever we pick has to expose the entries, not just accept a number. All three below show the same ticket: 01:15 already in Jira, 01:15 not yet pushed.

### M1 · ROW OPENS IN PLACE — my pick
<sub>`id: m1`</sub>

The duration becomes a disclosure. Opening it reveals the day's entries for that ticket, each with its start time, comment, push state and edit/delete, plus one add form at the foot.

One affordance covers ticket 7 (add), 9 (which entries did not make it) and 10 (edit/delete after push). No overlay, so it behaves the same on the phone in ticket 13 — it just pushes the card taller.

COST: the card reflows when you open a row. With several rows open the list gets long, so it probably wants one-open-at-a-time.

### M2 · POPOVER — superseded by M4 below
<sub>`id: m2`</sub>

Kept as the record. Its trigger stands: the duration is a real <button> with aria-expanded, and the chip appears on hover and focus only.

What did not stand is the popover itself. It needed dismissal, focus trapping, collision handling and a separate phone layout — four problems the dialog does not have.

### M3 · TYPE INTO THE ROW — fastest, incomplete
<sub>`id: m3`</sub>

The duration cell is an input. Type 00:30, press enter, and it ADDS an entry rather than overwriting the sum — the hint spells that out, because without it the interaction is genuinely ambiguous.

Unbeatable for the common case: log half an hour to a ticket without opening anything.

COST: it cannot show you the entries, so it cannot serve ticket 9 or 10 on its own. This is a companion to M1, not a rival — worth having BOTH, with the input for speed and the disclosure for everything else.

### S1 · FIRST RUN — no instances configured
<sub>`id: s1`</sub>

The rail still exists and still reads 0h 00m, because time is LOCAL: the day total comes from SQLite, not from Jira. Only the split has nothing to say.

Push is present but disabled rather than hidden — a control that vanishes teaches you nothing about what it would have done.

### S2 · LOADING — and this one falls out of the architecture
<sub>`id: s2`</sub>

The rail is FULLY LIVE while the issue list is still empty. Time entries, timers and pins are local; only the assigned-issue fan-out is remote. So the total, the split and the running timer paint instantly.

The Pinned card paints too — #6 caches summary and status precisely so pins survive a slow or dead instance. Only the instance cards are skeletons, and they still carry their names, which come from the local instances table.

### S3 · NOTHING LOGGED YET — the start of a day
<sub>`id: s3`</sub>

Every timer at 00:00 in the faint tone, both subtotals 0h 00m, no split bar (there is nothing to divide), Push disabled.

This is the state that tests the format rule hardest: five 00:00s down the column and a 0h 00m hero. Worth checking it reads as calm rather than broken.

### S4 · ALL PUSHED — end of day, everything in Jira
<sub>`id: s4`</sub>

Nothing is running and nothing is unpushed, so green, amber and red all leave the screen at once. Only the magenta primary remains, on the wordmark and the Push button — identity, not state.

A list with no state colour in it means you are done.

Northwind loses its warning here and the split shows both instances plainly.

### S5 · PARTIAL PUSH FAILURE — the state that matters most
<sub>`id: s5`</sub>

The design of record calls this out by name: a push is not transactional, each entry succeeds or fails alone, and the UI must show which ones did not make it. So: a banner with the count, per-row markers, a rail line, and Push becomes Retry 2.

Note the rows say "1 of 2 failed" — a row is a SUM, so it can be partly through. Open the row to see which entry.

SETTLED: failure has its own tone. Amber marks an entry that is merely still local; red marks one Jira rejected. The triangle and the words stay, so the difference never rests on colour alone.

### MOBILE · TODAY — 390 x 844, Android (ticket 13)
<sub>`id: mob`</sub>

The rail cannot survive at 216px on a phone, so it unfolds: the readout becomes a header block in the same dark tone, and nav drops to a bottom tab bar where a thumb can reach it.

Rows restack — summary first, then key and status beneath — so the summary gets the width it needs. Timer buttons are 44px, the floor for touch.

NO FAKE CHROME: no drawn status bar and no drawn keyboard. The real ones render on top of this, and painting our own would show doubled.

This is one SCREEN, not the whole document: the list runs past the bottom edge and scrolls, with the header and tab bar staying put.

The manual-entry sheet is now drawn — see M4 on the Manual entry page.

### R1 · THE LIST — what D has now
<sub>`id: r1`</sub>

Names, a count, a health icon. Your objection stands: on Today every one of those facts is already on screen below. Four rail rows to restate the content area.

It does earn its keep on Week and Settings, where there are no per-instance cards.

### R2 · HEALTH STRIP — the overview, minus the duplication
<sub>`id: r2`</sub>

Dots for identity, one line of state. It answers the only question the list answered that the content does not: "is something wrong?" — in two lines instead of a section.

Keeps your instance colours. Loses the per-instance issue counts, which the cards below already give you.

### R3 · WHERE THE DAY WENT — my pick
<sub>`id: r3`</sub>

Stops duplicating the list and shows something genuinely absent from the content area: today's time SPLIT by instance, as a bar and two figures. The section headers below give per-section subtotals, but nothing anywhere compares instances.

It also sits directly under the 5h 15m, so the rail reads top to bottom as one thought: how much, then where. Health still shows — Northwind carries the warning.

COST: one more thing to compute, and it is the only variant that needs data the current API does not return grouped this way.

### R4 · SILENT UNLESS BROKEN — zero redundancy
<sub>`id: r4`</sub>

Both states shown, because that is the only way to judge it. When everything is reachable the rail says nothing about instances at all; a failure raises one line.

The most honest answer to "it is redundant" — it removes the redundancy completely. But it also removes the quick overview you said you wanted: healthy looks identical to having no instances configured, and you cannot tell at a glance how many you have.

### R3a · SPLIT + TOTAL ROW — the literal reading
<sub>`id: r3a`</sub>

The block becomes a self-contained ledger: two instances, a rule, Total  5h 15m. Reads correctly on its own and you never have to connect it to anything above it.

COST: 5h 15m now appears twice in a 216px column, forty pixels apart. Two identical numbers that close together invite the reader to look for a difference between them.

### R3b · TOTAL HEADS THE SPLIT — my pick, and what D now uses
<sub>`id: r3b`</sub>

The 46px figure was ALREADY the combined total; this just stops treating it as something separate. Total, then the bar, then the two instances — one block, read top to bottom, no number repeated.

It also shortens the rail: the standalone instance section is gone entirely, because the split already carries both identity and health.

COST: the total is 46px and the parts are 13px, so the breakdown reads as a footnote to the total rather than as a table of equals. That is the correct emphasis for a glance, but it is a choice.

### BASELINE — what ships today
<sub>`id: baseline`</sub>

Recreated from web/index.html, that-card, that-button, that-alert and that-ticket-row: stock zinc tokens, system-ui, three type sizes, near-black accent.

Here so the three directions are judged against the real thing, not a memory of it. Flip any board's Mode chip to see dark.

It shows less than the others because it IS less — no timers, no day total, no push. Those land in tickets 7–9.

### A · PAPER — warm, editorial, unhurried
<sub>`id: paper`</sub>

Instrument Serif over Instrument Sans on a warm off-white. Borderless cards floating on soft tinted shadow, 28px rhythm, the day's total set big in serif. One terracotta accent, one green for a running timer.

WHY: you look at this thing all day. It reads as a notebook rather than a console, and the serif total makes "how much have I done" the loudest thing on screen.

COST: the least dense of the three. The Week grid — 7 columns of numbers — is where this direction has to prove itself, and generous rhythm is exactly what a grid cannot afford.

### B · RAIL — structured, product-like
<sub>`id: rail`</sub>

A dark left rail carries nav AND the instance list, so "which instances do I have and is one broken" is answered before you read anything. Each instance owns a hue at fixed lightness and chroma; that dot repeats on every row, in the Week grid, and in Settings. Manrope + JetBrains Mono, pill statuses, tabular figures.

WHY: the one direction whose colour does a job. Multi-instance is this app's whole premise and today nothing on screen encodes it.

COST: the most chrome, and a 232px rail is a real bite out of a phone (ticket 13). The hue system is also a commitment — it has to survive a fifth instance.

### C · FOCUS — chrome-free, big type
<sub>`id: focus`</sub>

No cards, no shadows, no boxes. Hairline rules, a 104px running total, and a single vermillion used ONLY for what is live and what is unpushed. Space Grotesk throughout at tight tracking.

WHY: the least to build and the least to maintain — it is mostly type and rules, which is a real virtue under a 14kB budget and vanilla JS. Scales to the Week grid better than either other option.

COST: austere. Errors get a rule and red text instead of a tinted box, which is quieter than a failed instance probably deserves. Also the most exposed — with no chrome to hide behind, every spacing mistake shows.

### M4 · DIALOG — one component, two anchorings
<sub>`id: m4`</sub>

Centred on the desktop, anchored to the bottom edge on the phone. Same markup, same content, one CSS difference — which is exactly why this beats the popover: M2 was quietly two designs.

IT ALSO DELETES THE OPEN LIST. that-confirm already wraps a native <dialog> and calls showModal(), and its own comment names what that supplies: focus trap, inert background, top layer, Esc dismissal, and focus returning to whatever opened it. Four of the five things left open for M2 are simply not our problem.

THE FIFTH IS ALREADY DECIDED TOO. that-confirm deliberately does NOT dismiss on backdrop click — <dialog> has no such behaviour, Esc is the safe exit, and adding it means hit-testing by hand. Same rule here.

ONE TRAP WORTH CARRYING OVER: Preflight's `* { margin: 0 }` is author origin and beats the UA's `dialog { margin: auto }`, so a dialog lands top-left in Firefox and Chromium unless margin is set explicitly. that-confirm.ts carries that note; this design needs it too.

### M4 · SHEET — the same dialog on the phone
<sub>`id: m4m`</sub>

Anchored to the bottom, rounded on the top corners, with a grab handle. The form stacks and every control goes to 46px, above the 44px touch floor. Padding uses env(safe-area-inset-bottom) so it clears the gesture bar rather than guessing at it.

It covers the tab bar on purpose — it is modal, so nav should not be reachable underneath.

NO FAKE CHROME, as on the other phone board: the real keyboard will push this up when the duration field takes focus, and drawing one would show doubled.

### D · HYBRID — the one to react to
<sub>`id: hybrid`</sub>

Rail from B, character from C, ticket list from A.

WHAT CHANGED FROM B: the rail was dull because it was a menu. Here it is the instrument — it carries the day's total at 46px, the running timer, the unpushed count and the Push button, so the thing you glance at is always in the same place whatever view you are on. Nav drops below it.

WHAT CHANGED FROM C: Space Grotesk, tight tracking and tabular figures carry over. C's single accent has since been SPLIT — magenta is the primary, and running, pending and failed each have their own tone. See the Palette split page.

WHAT CHANGED FROM A: the rows sit on borderless cards with a soft warm shadow, so each section is a distinct object and the rows have room to breathe — without A's serif or its cost in density.

OPEN: whether the per-instance hues earn their place next to a single-accent rule. They are currently identity only (7px dots), never state.
