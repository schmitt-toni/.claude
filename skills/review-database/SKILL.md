---
name: review-database
description: Review the database schema for correctness
---

Review the database implementation. Per default review everything in this repository, if the user specifies a specific file, review the file and anything that is related to the file.

Check the database schema. Are the correct and best types used. Do they fit the driver (for example: PostgreSQL doesn't need varchar, text is better).
Check the 
