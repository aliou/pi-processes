---
"@aliou/pi-processes": patch
---

Support oh-my-pi's `renderCall(args, options, theme)` argument order.

pi invokes `renderCall(args, theme, context)` while oh-my-pi passes the
render options second and the theme third (documented in OMP's
docs/extensions.md). The tool call renderer now detects pi's order by its
`Theme` class instance and normalizes both orders, fixing
`TypeError: theme.fg is not a function` crashes when rendering `process`
tool calls under oh-my-pi. Supersedes #55.
