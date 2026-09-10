# A week row with no time, and a search that leaves nothing behind

**Date:** 2026-09-10
**Supersedes:** the line in [`2026-09-02-week-view-design.md`](2026-09-02-week-view-design.md) that
says a row appears only when it has an entry in the week — decision 1 below replaces it.
**Superseded by:** nothing

Settled with the owner on the local browser companion, 2026-09-10, for **#84** (search for any issue
and log time against it without pinning it) and **#139** (Week shows a pinned ticket even when
nothing was logged against it that week). The two tickets create the same new thing — a row in the
week grid holding no time — so they were designed together and share decisions 1 and 3.

Options were rendered in the prototype's own markup and tokens rather than described, and the widths
below are the real ones.

---

## Decision 1 — a week row with no time is an ordinary row

**A row with nothing logged against it in the displayed week looks exactly like any other row.** It
takes its place in the grid's existing order — instance position, then issue key — carries no mark
of any kind, shows an em dash in each of its seven day cells, and shows **an em dash in its row
total**, not `0h 00m`. A zero would claim the week holds something it does not.

Three shapes were drawn: the ordinary row, a row whose key carries a pin glyph, and a foot section
holding empty rows below the worked ones under a thin rule. The owner chose the ordinary row.

**A consequence, chosen deliberately:** a row that is there because it is pinned and a row that is
there because it was just searched for are **indistinguishable**. Nothing on the row says which, and
that is the point — the grid shows what you are working on this week, not why each line is present.

This reverses the week view design's rule that *"a row appears when it has at least one entry in the
week. The grid is not a list of assigned or pinned tickets; it is what the week actually contains."*
That document is corrected by whichever of #84 and #139 lands first.

## Decision 2 — an entry against an issue with no row appears beside Pinned

Logging from a search result against an issue that is neither assigned nor pinned leaves an entry
with nowhere to live on Today: the instance cards hold assigned and pinned issues, and it is neither.

**A second section, headed `Logged today, not on your list`, holds those entries.** It sits in the
**right half of a two-column grid whose left half is Pinned**, level with it, using the same page
heading treatment and the same table shape as the cards below.

**Pinned takes the left half permanently.** It does not span the full width when the right half is
empty, and the right half carries **nothing at all** — no heading, no card, no line of text — until
there is something to put in it. This is the whole reason for the layout: logging an hour off-list
must not resize Pinned under the cursor.

The cost is paid in Pinned's summaries, which clip earlier at half width than they do today. That
was drawn at both widths and accepted.

**Pinned keeps its own empty state**, the card reading `Nothing pinned.`, because that is an
invitation: it tells a reader the feature exists. The right half has no equivalent, because
"nothing logged outside your list" is a non-event and true on most days. The two sides are
deliberately asymmetric.

**The three states, in the order they will be met:**

| State | Left half | Right half |
| --- | --- | --- |
| Ordinary day | Pinned, with its rows | Empty. Nothing drawn. |
| Something logged off-list | Pinned, with its rows | The section, with its rows |
| Nothing pinned, something off-list | `Nothing pinned.` | The section, with its rows |

The columns will often be unequal in height. The instance cards below already are.

**This supersedes an earlier answer in the same session.** The owner first chose that such an entry
should appear nowhere on Today, on the grounds that a third card would clutter the view and adding
the row to an instance card would be misleading. Putting the section beside Pinned rather than below
it removed the cost that answer was avoiding, and the owner reversed it. **Both objections still
hold and are honoured:** the instance cards never gain a row they should not have, and their
headings keep counting only what they mean.

At narrow widths the grid collapses to one column, as the instance grid already does, so the section
stacks under Pinned — but only when there is something to stack.

## Decision 3 — Week's search adds a row; the cells do the logging

The prototype contradicted itself here. Its caption says the search is *"for putting a new ticket
into the week"*, its result row carries a Log control, and its footer says *"Logging against a
result adds it to this week."* Since #105, every day cell opens a dialog scoped to its own day.

**Choosing a result puts an empty row in the grid. It logs no time.** The row's cells are then used
exactly as any other row's are: click a day, the dialog opens scoped to that day. Nothing has to
answer "which day", because the answer is the cell you point at.

Two alternatives were drawn and rejected: logging against today, which has nothing to mean on a week
that does not contain today; and a day picker in the result row, which is a control the design does
not have and a state the dialog has never had.

**The row is transient.** A row with nothing logged against it **loses its place as soon as the view
is navigated away from**. It is not pinned, not stored, and not remembered. Once time is logged into
one of its cells it is an ordinary row like any other, and it persists because it has entries — not
because anything recorded that it was added.

**Week's result rows carry no Log control**, because logging does not happen there. Today's result
rows keep theirs.

## Decision 4 — the mark for pulling a ticket into the week

Pinning is a standing choice about the day view's list. Putting a ticket into a week is a one-off.
They are different jobs, so they get different marks.

**The mark is grid lines with a return arrow beneath them** — two full-width rules, then the return
glyph turning its corner into the row below. It says both halves of the idea: what the ticket joins,
and the act of joining.

```
M4 5h16    M4 10h16    M20 14v1a2 2 0 0 1-2 2H8    M11 14l-3 3 3 3
```

Nine marks were drawn across three rounds. A bare plus was rejected as too vague and already used
for adding an instance. A downward arrow onto a line, and a row of cells with one, were both
rejected for reading as *download*. A calendar with a plus was rejected as unreadable at 18px. The
return key was the owner's own suggestion, and it is right for a reason worth recording: **return is
the one arrow that never means transfer.** It means commit this, put it in — it turns a line you
typed into a line that exists, which is exactly what choosing a result does to the grid.

**Both controls sit in Week's result row:** the return mark first, the pin second. Judged at the
panel's true width of 300px, where the second control costs 34px taken from the summary. The owner
compared it against Today's own row, which already carries two controls in the same width, and
accepted the crowding.

**Not in scope, but noted:** the mark implies a keyboard shortcut — with a result focused, return
does what the mark shows. Neither ticket includes it, and it should not be built without being
asked for.

## What each ticket takes from this

**#139** takes decision 1 and nothing else. Its rows come from the pins the app already holds.

**#84** takes decisions 1, 2, 3 and 4, plus everything already settled in its own ticket: the search
input in each header, the results panel grouped by instance, Done issues always included, the
existing endpoint widened rather than duplicated, and the deletion of the Pinned card's own pin
form.

**Whichever lands first corrects the week view design document.** The second inherits the correction
rather than repeating it.

## Wording to confirm at review

The section heading `Logged today, not on your list` and Week's footer line `Searching all
instances. Choosing a result adds it to this week; click a day to log time.` were shown in the
mockups and drew no objection, but were never chosen against alternatives. They stand unless the
owner says otherwise.
