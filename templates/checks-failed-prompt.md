The checks fail on your branch but pass on `main`, so your change introduced the failure. Fix it, then run the checks again yourself before finishing.

Attempt {{attempt}} of {{max}}.

## {{check}} failed

```
{{output}}
```

Rules are unchanged: do not edit `package.json` scripts, CI configuration, or skip tests.
Commit your fix with `git commit`. If `/state/{{result_file}}` needs updating because your approach changed, update it.
