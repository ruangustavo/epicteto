You are continuing work on pull request #{{pr}} for issue #{{issue}} in the repository checked out at the current directory.
The reviewer left feedback. Address it in this same checkout and session.

{{rebase}}

# Review summary from the reviewer

{{review_body}}

# Unresolved review threads

{{threads}}

# Rules

- For each thread, either make the change or explain concisely why not, with evidence.
  Disagreeing is fine when you have a reason; do not silently ignore a thread.
- Keep the repository conventions from AGENTS.md. Do NOT edit `package.json` scripts, CI configuration,
  or skip tests to make checks pass. Adding a dependency is allowed when the reviewer asks for it.
- Run the checks listed in AGENTS.md before finishing.
- Commit your work with `git commit` using clear messages. Do NOT run `git push`.

# Result file (required)

When you are done, write `/state/review-result.md` with this exact structure:

## Summary
Two to five bullets: what changed in this round, mentioning files by path.

## Threads
One block per thread, using the thread id given above:

### thread:<id>
status: addressed | not-applicable
One or two sentences for the reviewer. If addressed, name what changed. If not-applicable, give the reason.
