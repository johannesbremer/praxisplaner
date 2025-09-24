# Mental Model: Rule Sets

Rule sets should be stored in a **git-like model**.

- When a user saves, they must provide a name for the rule set (similar to a commit message).
- The user can return to any previously saved rule set.
- When the user makes modifications (e.g., changing active rules, documentation, work times, locations, or appointment types), we **do not** update the existing rule set. Instead, we create a new `ungespeichert` rule set, based on the rule set they started editing.
- The user cannot switch to another rule set without first triggering the **"Regelset speichern"** modal, which requires them to either save or discard their changes. This ensures that there is never more than one conflicting `ungespeichert` state.
- Note: The `ungespeichert` state is still persisted in Convex, just like all other rule sets (which can be confusing).
