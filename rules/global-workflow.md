# Global Workflow Rules and Guidelines

## Git

- **Never run `git commit` yourself.** Commits are GPG-signed, and the pinentry prompt hangs the
  Claude Code session. Stage the change, then present the exact command for the user to run.
- The same applies to anything else that creates a signed object — `git tag -s`, and a `git merge`
  that produces a merge commit.
- For a non-trivial message, write it to a file and present `git commit -F <path>`, so the user
  does not have to paste a heredoc into their terminal.

## Refactoring

- When breaking up a large class, extract within the same file first Not files are added, moved, or deleted in this step.
- Extracting is behavior-preserving: do not change logic, signature, or naming beyond what the extraction itself requires. Anything else is a seperate change, proposed seperately.
- Present the in-file result and wait for explicit approval before moving anything into dedicated files.
