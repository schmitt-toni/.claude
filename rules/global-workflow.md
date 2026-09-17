# Global Workflow Rules and Guidelines

## Refactoring

- When breaking up a large class, extract within the same file first Not files are added, moved, or deleted in this step.
- Extracting is behavior-preserving: do not change logic, signature, or naming beyond what the extraction itself requires. Anything else is a seperate change, proposed seperately.
- Present the in-file result and wait for explicit approval before moving anything into dedicated files.
