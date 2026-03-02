---
date: 2026-02-26
title: Overlay UX Fixes
directory: /Users/alioudiallo/code/src/pi.dev/pi-processes
project: pi-processes
status: pending
dependencies: []
dependents: []
---

# Overlay UX Fixes

## Goal / Overview

Fix five concrete UX bugs in the floating log overlay (`/ps:logs`) and the shared
`LogFileViewer` helper. These are all isolated to two files and do not require any
architectural changes. The dock architecture plan (`dock-architecture`) can be executed
in parallel or after this one.

The bugs, as reported:

1. **Follow not stopping** — disabling follow mode on a running process still causes the
   view to scroll as new lines arrive.
2. **Search scroll** — when a search is active and the process is still streaming, the
   view position should freeze, but the total line count in the status bar should keep
   updating to show that output is still coming.
3. **Tab / Shift-Tab navigation** — the overlay uses `←/→` and `h/l` to switch tabs;
   it should use `Tab` / `Shift-Tab` instead.
4. **Footer mode split** — in normal mode the footer shows `n/N match` even though
   those keys only work in search mode. In search mode the footer should be replaced
   with `n/N next/prev  esc clear search`.
5. **Search keybindings discoverability** — the `/` key to open search is shown in
   normal mode but `n/N` are not; this asymmetry confuses users.

---

## Root cause analysis

### Follow bug (bugs 1 and 2 share the same root cause)

`LogFileViewer` uses an offset-from-tail scroll model:

```ts
// current model
private scrollOffset = 0;  // 0 = at tail, higher = scrolled up

// in renderLines():
const endIdx = this.follow ? total : Math.max(0, total - this.scrollOffset);
```

When `follow` is disabled and `scrollOffset = 0`, `endIdx = total - 0 = total`.
As `total` grows (new lines stream in), `endIdx` grows with it — the view silently
tracks the tail. The user turned off follow but the view keeps scrolling.

The same model breaks search: `jumpToMatchLine` sets `scrollOffset` relative to the
tail at that moment. As total grows, `total - scrollOffset` also grows, shifting the
view away from the matched line.

**Fix: replace offset-from-tail with an absolute end-line index.**

New model:

```ts
private anchorEnd: number | null = null;
// null  → follow mode: endIdx = total (dynamic)
// number → frozen: endIdx = this.anchorEnd (only changes on explicit scroll)
```

All scroll methods set `anchorEnd` to an absolute value and clear `follow`.
`follow = true` always means `anchorEnd = null`. `renderLines` is updated to use
`anchorEnd ?? total`.

---

## Files to change

| File | What changes |
|---|---|
| `src/components/log-file-viewer.ts` | Replace scroll model; update all scroll/follow methods and renderLines |
| `src/components/log-overlay-component.ts` | Remap Tab/Shift-Tab; split footer by mode |

No other files are touched by this plan.

---

## Component breakdown

### `LogFileViewer` — new scroll model

**Remove** the `scrollOffset` field. **Add**:

```ts
/** Absolute index of the last visible line (1-based).
 *  null = follow mode; always shows latest lines. */
private anchorEnd: number | null = null;
```

Update every scroll/follow method:

```ts
scrollToTop(): void {
  this.anchorEnd = 0; // clamped up to maxLines in renderLines
  this.follow = false;
}

scrollToBottom(): void {
  // Scroll to tail without enabling follow. Next render will show latest lines
  // but won't keep tracking new ones unless follow is also enabled.
  this.anchorEnd = null;
  this.follow = false;
}

/** delta > 0 = scroll toward older content, delta < 0 = toward newer. */
scrollBy(delta: number): void {
  // If currently following or at tail, snapshot the current tail first.
  if (this.anchorEnd === null) {
    const lines = this.applyFilter(this.readAllLines());
    this.anchorEnd = lines.length;
  }
  this.anchorEnd = Math.max(0, this.anchorEnd + delta);
  this.follow = false;
}

toggleFollow(): boolean {
  this.follow = !this.follow;
  if (this.follow) {
    this.anchorEnd = null; // release anchor; next render tracks tail
  } else {
    // Snapshot current tail so the view freezes
    const lines = this.applyFilter(this.readAllLines());
    this.anchorEnd = lines.length;
  }
  return this.follow;
}
```

Update `jumpToMatchLine` (used by search):

```ts
private jumpToMatchLine(lineIdx: number): void {
  // lineIdx is 0-based; anchorEnd is 1-based (exclusive upper bound)
  this.anchorEnd = lineIdx + 1;
  this.follow = false;
}
```

Note: remove the `total` parameter from `jumpToMatchLine` — it's no longer needed.
Update callers (`setSearch`, `nextMatch`, `prevMatch`) to drop that argument.

Update `renderLines`:

```ts
renderLines(width: number, maxLines: number): string[] {
  const allLines = this.readAllLines();
  const lines = this.applyFilter(allLines);
  const total = lines.length;

  if (total === 0) return [dim("(no output yet)")];

  // Refresh search matches against potentially grown data.
  // This does NOT change anchorEnd, so the view stays frozen during search.
  if (this.searchQuery) {
    this.searchMatches = this.computeMatches(lines);
    if (this.searchCurrentMatch >= this.searchMatches.length) {
      this.searchCurrentMatch = Math.max(0, this.searchMatches.length - 1);
    }
  }

  // Resolve anchor: null = follow (tail), number = absolute frozen end.
  const rawEnd = this.anchorEnd ?? total;
  // Clamp to valid range.
  const endIdx = Math.min(total, Math.max(0, rawEnd));
  const startIdx = Math.max(0, endIdx - maxLines);

  // ... rest of rendering (highlight matches, stderr coloring) unchanged
}
```

Update `renderStatusBar` to use the new model for the percentage/line display:

```ts
// Replace the old endIdx calculation:
const rawEnd = this.anchorEnd ?? total;
const endIdx = Math.min(total, Math.max(0, rawEnd));
const pct = total === 0 ? 100 : Math.round((endIdx / total) * 100);
```

---

### `LogOverlayComponent` — Tab/Shift-Tab + footer split

**In `handleNormalInput`:**

Remove:
```ts
if (matchesKey(data, "left") || data === "h") { this.prevTab(); return true; }
if (matchesKey(data, "right") || data === "l") { this.nextTab(); return true; }
```

Replace with:
```ts
if (data === "\t") { this.nextTab(); return true; }
if (data === "\x1b[Z") { this.prevTab(); return true; } // Shift+Tab VT sequence
```

Also **remove** `n/N` bindings from normal mode (move them to search mode only):

```ts
// REMOVE from handleNormalInput:
if (data === "n") { viewer.nextMatch(); ... }
if (data === "N") { viewer.prevMatch(); ... }
```

**In `handleSearchInput`:**

Add `n/N` bindings here instead (since search mode is where match navigation belongs):

```ts
if (data === "n") {
  this.currentViewer()?.nextMatch();
  this.tui.requestRender();
  return true;
}
if (data === "N") {
  this.currentViewer()?.prevMatch();
  this.tui.requestRender();
  return true;
}
```

**In `renderFooterContent`:**

Normal mode — remove `n/N`, update tab hint:

```ts
// Normal mode footer (replace current implementation):
const footer =
  `${dim("tab/shift+tab")} switch  ` +
  `${dim("g/G")} top/bot  ` +
  `${dim("j/k")} scroll  ` +
  `${dim("/")} search  ` +
  `${dim("s:")}${filter}  ` +
  `${dim("f:")}${follow}  ` +
  `${dim("q")} quit`;
```

Search mode — show navigation hint, not generic search hint:

```ts
// Search mode footer (replace current implementation):
const hint =
  `${dim("n")} next match  ` +
  `${dim("N")} prev match  ` +
  `${dim("esc")} clear search`;
```

---

## Implementation order

- [ ] 1. Update `LogFileViewer` scroll model
  - [ ] Remove `scrollOffset` field, add `anchorEnd: number | null`
  - [ ] Update `scrollToTop()`, `scrollToBottom()`, `scrollBy()`, `toggleFollow()`
  - [ ] Update `jumpToMatchLine()` — remove `total` param, update callers
  - [ ] Update `renderLines()` to use `anchorEnd ?? total`
  - [ ] Update `renderStatusBar()` to use new endIdx calculation
- [ ] 2. Update `LogOverlayComponent` keybindings
  - [ ] Replace `←/→ h/l` with `\t` / `\x1b[Z`
  - [ ] Remove `n/N` from `handleNormalInput`
  - [ ] Add `n/N` to `handleSearchInput`
- [ ] 3. Update `LogOverlayComponent` footer
  - [ ] Normal mode: remove `n/N`, use `tab/shift+tab`
  - [ ] Search mode: show `n/N  esc clear search`
- [ ] 4. Run `pnpm typecheck && pnpm lint` — fix any issues
- [ ] 5. Manual test: start a long-running command (`while true; do echo foo; sleep 0.1; done`), open overlay with `/ps:logs`, press `f` to disable follow — confirm view freezes. Press `/`, type a query, confirm view stays at match as output continues streaming. Press `Tab` to cycle tabs.

---

## Error handling / edge cases

- `scrollBy` when `anchorEnd === null`: must snapshot `total` first before applying the
  delta; otherwise the first scroll would compute `0 + delta` which is wrong.
- `anchorEnd` can become stale if lines are somehow removed (they aren't in the current
  design — log files only grow). Still, clamp `anchorEnd` to `[0, total]` in
  `renderLines` for safety.
- `toggleFollow()` called when already following (`anchorEnd === null`): must still
  snapshot `total` before setting `follow = false`. Since `anchorEnd` is already null,
  we read `total` fresh from the file.
- Shift-Tab sequence: `\x1b[Z` is the standard VT100 sequence. Some terminals send
  `\x1b\t` instead. Handle both:
  ```ts
  if (data === "\x1b[Z" || data === "\x1b\t") { this.prevTab(); return true; }
  ```

---

## Testing strategy

1. `pnpm typecheck` — must pass with zero errors
2. `pnpm lint` — must pass with zero errors
3. Manual: follow toggle  
   Start `while true; do echo line $RANDOM; sleep 0.1; done`, open overlay.  
   Follow is on by default. Press `f` — view must freeze immediately. Confirm the
   status bar percentage stays fixed while the line count (`L50/120`) grows.
4. Manual: search + streaming  
   With same process, press `/`, type `line`, Enter. Jump to a match. Confirm the
   view stays at that match as new lines come in. Confirm total in status bar grows.
5. Manual: Tab navigation  
   With 2+ processes, press `Tab` — must switch to next tab. Press `Shift-Tab` — must
   go back. Arrow keys must no longer switch tabs.
6. Manual: footer modes  
   Normal mode footer must not show `n/N`. Press `/`, type query, Enter — footer must
   now show `n  next match  N  prev match  esc  clear search`. Press `n/N` — must
   navigate matches. Press `Esc` — returns to normal mode.

---

## Decision points

- **Scroll model change**: switched from offset-from-tail (`scrollOffset`) to absolute
  anchor (`anchorEnd`). This is a breaking change to `LogFileViewer`'s internal state
  but the public interface stays identical. The dock component uses the same viewer and
  benefits from this fix automatically.
- **`scrollToBottom()` no longer enables follow**: this is intentional. `scrollToBottom`
  just moves the viewport to the tail. Follow mode (auto-tracking) must be explicitly
  enabled with `f`. The two concepts are now cleanly separated.
- **`n/N` removed from normal mode**: they did nothing useful without an active search
  query. Moving them to search mode makes their context clear.

---

## Rejected approaches

- **Keep offset-from-tail, add a "frozen" flag**: adds a boolean that would need to be
  checked everywhere scrollOffset is used. The absolute anchor approach is cleaner.
- **Use a separate `viewEnd` field alongside `scrollOffset`**: two sources of truth for
  the same thing.
