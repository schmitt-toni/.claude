---
paths:
  - "**/.gitignore"
---

**Always ignore everything by default.** When creating a new `.gitignore` always ignore everything per default and include files and folders that need to commited as an exception. This will make the `.gitignore` long, but exhaustive and (especially when working with agents) more secure that nothing gets commited on accident. If there are good reasons going against that rule, present it to the user and let the user decide.
