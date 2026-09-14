---
paths:
  - "**/package.json"
  - "**/.nvmrc"
  - "**/pnpm-workspace.yaml"
  - "**/turbo.json"
---

# Node.js Project Rules and Guidelines

## Toolchain

- Use the package manager pinned in `packageManager`, through corepack. Do not substitute a
  different one and do not silently upgrade it.
- If a required binary is missing from `PATH`, say what you are about to change about the
  environment before you change it, and say how to undo it.
