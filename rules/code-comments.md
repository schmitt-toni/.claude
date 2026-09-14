# Comment Rules and Guidelines

- Comment the **current state only**. Never write what the code used to be, what it replaced, or
  what will replace it. No "was X before", "temporary until Y", "will be replaced in milestone Z",
  "the real version lands with W". A comment is read by someone looking at the code as it is now.
- A comment explains **why**: the constraint, the trade-off, the failure it prevents, the
  alternative that was rejected and what went wrong with it. The code already says what it does.
- Comment the non-obvious decision, not the routine one. If a choice is the conventional default,
  it needs no comment. Write one when a reader would reasonably ask "why not the other way?".
- Explain a schema, a format or a unit whenever the type does not: what `1999` means, what a basis
  point is, which end of a range is inclusive, which timezone a timestamp is in.
- Do not restate the signature and do not narrate the next line.
- Referencing a ticket, an ADR or a spec as the source of a rationale is fine. Referencing a
  milestone to say *when* something happens is not.
