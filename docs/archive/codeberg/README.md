# Codeberg archive

ThatApp lived on Codeberg until 2026-11-19. Closed issues and pull requests did not move to GitHub. These files keep the ones that hold something the repository does not record anywhere else: an owner decision, the reason for a design, a rejected approach, a bug's root cause, or a declined idea.

Elsewhere in the repository, `CB#<n>` names Codeberg item `<n>`. It links here when the item is archived. The original is at `https://codeberg.org/DionGerrese/ThatApp/issues/<n>`.

- [CB#35](35.md): The e2e suite runs against the dev database, not a disposable one
- [CB#41](41.md): An instance with neither URL reports an unexpected error
- [CB#59](59.md): The pin flow's canvas source contradicts CB#44's spec
- [CB#74](74.md): `make fmt` rewrites seven committed files: prettier formatting is gated by nothing
- [CB#79](79.md): A failed Jira call discards Jira's own explanation, so the failure cannot be diagnosed
- [CB#80](80.md): Settings: explain what an API token needs before it can push worklogs
- [CB#83](83.md): Sort the assigned issue listing on any displayed column
- [CB#89](89.md): Settings: take it out of the nav and redesign the page
- [CB#117](117.md): The shipped UI has drifted from the prototype, and the count is unknown
- [CB#144](144.md): Today's instance cards leave holes: a short card wraps under a tall one instead of filling the space beside it
- [CB#175](175.md): [CB#139] A pinned ticket has a row in the current week
- [CB#177](177.md): [CB#39] One home for alertFor and messageOf
- [CB#183](183.md): A running timer's figure and the Today sort disagree
- [CB#192](192.md): A row that a sort moves loses its start/stop button
- [CB#200](200.md): Settings: two saves of the same instance in flight can undo the second
- [CB#204](204.md): A running timer's elapsed time is missing from the card tally and the rail total
- [CB#217](217.md): tooltip.spec.ts's keyboard-focus test uses .focus(), not a real Tab
- [CB#220](220.md): CI runs on a self-hosted runner instead of Codeberg's shared pool
- [CB#242](242.md): [CB#209] One timer start or stop at a time
- [CB#253](253.md): An MCP server, so an AI assistant can read and log time through the app
- [CB#267](267.md): A tooltip cannot be dismissed with Escape or hovered, as WCAG 1.4.13 asks
- [CB#276](276.md): Closing an issue does not remove its status/* label
- [CB#281](281.md): Focus falls to <body> when the entry dialog's busy state disables its save button
- [CB#284](284.md): Hosted Forgejo Actions will be disabled for this repository
- [CB#307](307.md): tab-return.spec's background-tab catch-up test is flaky in Firefox under load
- [CB#309](309.md): tooltip.spec's accessible-name test is flaky in Chromium: the hover tooltip sometimes never opens
- [CB#322](322.md): The release script sets :stable on a stable release, and the README updates from it
- [CB#328](328.md): [Process] A node test asserts on a value read from a happy-dom element
