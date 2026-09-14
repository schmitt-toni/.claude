---
paths:
  - "**/*.csproj"
  - "**/*.props"
  - "**/*.targets"
  - "**/Directory.Build.props"
  - "**/Directory.Packages.props"
---

# Project files Rules and Guidelines for .NET

- Before creating or editing a `.csproj`, read `Directory.Build.props` and any `Directory.Build.targets` or `Directory.Packages.props` above it in the tree.
- Never restarte a property that one of those files already sets - `TargetFramework`, `Nullable`, `LangVersion`, `ImplicitUsings`, analyzer configuration, and so on. A `.csproj` contains only what is genuienly specific to that one project.
- A property that should hold for every project belongs in `Directory.Build.props`, not copied into each `.csproj`
- If no `Directory.Build.props` exists, do not introduce one unprompted. Ask first.
