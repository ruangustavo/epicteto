You are implementing a GitHub issue in the repository checked out at the current directory.
Read AGENTS.md first: it has the boot recipe, the checks, and the conventions.

# Issue #{{number}}: {{title}}

{{body}}

{{comments}}

# Rules

- Implement exactly what the issue asks. Follow the repository conventions in AGENTS.md.
- Add or update tests for the behavior you change.
- Run the checks listed in AGENTS.md yourself before finishing.
- Do NOT edit `package.json` scripts, CI configuration, or skip tests to make checks pass.
- Do NOT run `git push`. Commit your work with `git commit` using clear messages.
- If the issue is ambiguous in a way that changes the implementation, do not guess:
  write your questions under `## Questions` in the result file and stop without changing code.

# Result file (required)

When you are done, write `/state/result.md` with exactly these sections:

## Problem
One or two sentences: what was wrong or missing, from the user's point of view.

## Fix
Bullet list of what you changed and why. Mention files by path.

## Notes
Anything the reviewer should know: trade-offs, follow-ups, things you deliberately left out.
Write "None." if empty.
