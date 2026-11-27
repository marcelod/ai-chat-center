# Group sessions by project (0.6.8)

Backlog idea 19. Design agreed with the author on 2026-11-27.

## Behaviour

- Optional, **off by default**: "Group by project" checkbox in the settings menu, kept per browser in
  `localStorage` (`acc.groupByProject`) like the other UI preferences (`ui/src/prefs.ts`). Off, the list is
  exactly as before (pinned first, then the hub's order: most recent first).
- On: one group per session folder (`cwd`, trailing `/` or `\` ignored). The header shows the last part of the
  path and the count ("ai-chat-center (3)"); the full path is the header's `title`.
- Groups are ordered by their most recent conversation; inside a group, most recent first. Both come from the
  hub's order, which is already most recent first (`ClaudeCodeProvider` sorts by the last event), so the
  grouping keeps the input order instead of sorting again.
- Pinned conversations stay on top, outside the groups.
- The header is a button with `aria-expanded` and a ▾/▸ chevron; clicking it opens or closes the group.
  Closed groups are remembered in `localStorage` (`acc.closedGroups`, a JSON array of folder keys); groups are
  open by default, so a new folder shows its conversations.
- A closed group's header shows whether any of its conversations is working (busy dot), has subagents working
  (pill with the total) or has new messages (badge with the total unread), with screen-reader text for each.
- While the search box has text, the groups are ignored and the matching conversations are listed flat.
- The collapsed (icon-only) list on wide screens also ignores the groups: there is no room for the headers.

## Code

- `ui/src/groups.ts`: pure `folderName(cwd)`, `groupByFolder(sessions)` → `{ pinned, groups }` and
  `groupActivity(group, unread)`, unit tested in `ui/src/groups.test.ts`.
- `ui/src/prefs.ts`: `groupByProject` boolean preference and the closed groups store (`useClosedGroups`).
- `SessionList.tsx`: the row rendering moved into a local function so flat and grouped lists share it.
