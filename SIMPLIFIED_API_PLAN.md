# Simplified Copy-on-Write API Plan

## Goal

Make the copy-on-write mechanism transparent to UI consumers. The UI should just call create/update/delete functions with a `practiceId`, and the backend automatically handles the unsaved rule set.

## Design Principles

1. **Queries are simple**: Just pass `ruleSetId` to view any rule set's content
2. **Mutations are automatic**: Pass `practiceId` and the mutation auto-creates/uses the unsaved rule set
3. **Only save/discard are special**: These are the only functions that explicitly manage rule sets

---

## API Structure

### 1. Queries (Read-Only - View Any Rule Set)

**Pattern**: All queries take `ruleSetId` to view content of ANY rule set (active, unsaved, or historical)

```typescript
// entities.ts - All queries
getAppointmentTypes({ ruleSetId });
getPractitioners({ ruleSetId });
getLocations({ ruleSetId });
getBaseSchedules({ ruleSetId });
getBaseSchedulesByPractitioner({ ruleSetId, practitionerId });
```

**Use case**:

- View active rule set in `/praxisplaner`
- View unsaved rule set when editing
- View historical rule sets in simulation/version history

---

### 2. Mutations (Auto-Handle Unsaved Rule Set)

**Pattern**: All mutations take `practiceId` (NOT `ruleSetId`) and automatically:

1. Check if unsaved rule set exists for this practice
2. If not, create it by copying from active rule set
3. Apply the mutation to the unsaved rule set

```typescript
// entities.ts - Appointment Types
createAppointmentType({
  practiceId,
  name,
  duration
})

updateAppointmentType({
  practiceId,
  appointmentTypeId,
  name?,
  duration?
})

deleteAppointmentType({
  practiceId,
  appointmentTypeId
})

// entities.ts - Practitioners
createPractitioner({
  practiceId,
  name,
  tags?
})

updatePractitioner({
  practiceId,
  practitionerId,
  name?,
  tags?
})

deletePractitioner({
  practiceId,
  practitionerId
})

// entities.ts - Locations
createLocation({
  practiceId,
  name
})

updateLocation({
  practiceId,
  locationId,
  name?
})

deleteLocation({
  practiceId,
  locationId
})

// entities.ts - Base Schedules
createBaseSchedule({
  practiceId,
  practitionerId,
  locationId,
  dayOfWeek,
  startTime,
  endTime,
  breakTimes?
})

updateBaseSchedule({
  practiceId,
  scheduleId,
  practitionerId?,
  locationId?,
  dayOfWeek?,
  startTime?,
  endTime?,
  breakTimes?
})

deleteBaseSchedule({
  practiceId,
  scheduleId
})
```

**Internal Logic**: Each mutation:

1. Calls `getOrCreateUnsavedRuleSet(db, practiceId)` helper
2. Validates entity belongs to that unsaved rule set (for update/delete)
3. Performs the operation
4. Returns result

---

### 3. Rule Set Management (Special Functions)

```typescript
// ruleSets.ts

// Get the unsaved rule set for a practice (if exists)
getUnsavedRuleSet({ practiceId })
// Returns: Doc<"ruleSets"> | null

// Get the active rule set for a practice
getActiveRuleSet({ practiceId })
// Returns: Doc<"ruleSets"> | null

// Get any rule set by ID (for viewing)
getRuleSet({ ruleSetId })
// Returns: Doc<"ruleSets"> | null

// Get all saved rule sets for a practice (for version history)
getSavedRuleSets({ practiceId })
// Returns: Doc<"ruleSets">[]

// Save the unsaved rule set (make it permanent)
saveUnsavedRuleSet({
  practiceId,
  description,
  setAsActive?
})
// - Validates saved === false
// - Sets saved = true
// - Updates description
// - Optionally sets as active
// Returns: void

// Discard the unsaved rule set (delete it and all its entities)
discardUnsavedRuleSet({ practiceId })
// - Deletes unsaved rule set
// - Cascades to all entities
// Returns: void

// Set which saved rule set is active
setActiveRuleSet({
  practiceId,
  ruleSetId
})
// - Validates rule set is saved (saved === true)
// - Sets as active for practice
// Returns: void
```

---

## Implementation Changes

### File: `convex/copyOnWrite.ts`

**Add new helper function:**

```typescript
/**
 * Gets the unsaved rule set for a practice, or creates one if it doesn't exist.
 * Creates by copying from the active rule set.
 */
export async function getOrCreateUnsavedRuleSet(
  db: DatabaseWriter,
  practiceId: Id<"practices">,
): Promise<Id<"ruleSets">> {
  // Check if unsaved already exists
  const existing = await findUnsavedRuleSet(db, practiceId);
  if (existing) {
    return existing._id;
  }

  // Get active rule set to copy from
  const activeRuleSet = await db
    .query("ruleSets")
    .withIndex("by_practiceId_isActive", (q) =>
      q.eq("practiceId", practiceId).eq("isActive", true),
    )
    .first();

  if (!activeRuleSet) {
    throw new Error("No active rule set found for this practice");
  }

  // Create new unsaved rule set
  const newVersion = activeRuleSet.version + 1;
  const newRuleSetId = await db.insert("ruleSets", {
    createdAt: Date.now(),
    description: "Ungespeicherte Änderungen",
    isActive: false,
    parentVersions: [activeRuleSet._id],
    practiceId: practiceId,
    saved: false,
    version: newVersion,
  });

  // Copy all entities atomically
  await copyAllEntities(db, activeRuleSet._id, newRuleSetId, practiceId);

  return newRuleSetId;
}
```

---

### File: `convex/entities.ts`

**Changes to ALL mutations:**

1. Remove `ruleSetId` from args
2. Keep `practiceId` in args
3. Add call to `getOrCreateUnsavedRuleSet(ctx.db, args.practiceId)` at start
4. For update/delete: Validate entity belongs to the unsaved rule set
5. Remove `ensureUnsavedRuleSet()` call (no longer needed)
6. Remove `validateRuleSet()` call (replaced by entity validation)

**Example - Before:**

```typescript
export const createAppointmentType = mutation({
  args: {
    duration: v.number(),
    name: v.string(),
    practiceId: v.id("practices"),
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    await ensureUnsavedRuleSet(ctx.db, args.ruleSetId);
    await validateRuleSet(ctx.db, args.ruleSetId, args.practiceId);

    // Check uniqueness...
    // Insert...
  },
});
```

**Example - After:**

```typescript
export const createAppointmentType = mutation({
  args: {
    duration: v.number(),
    name: v.string(),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(ctx.db, args.practiceId);

    // Check uniqueness in this rule set...
    const existing = await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId_name", (q) =>
        q.eq("ruleSetId", ruleSetId).eq("name", args.name),
      )
      .first();

    if (existing) {
      throw new Error("Appointment type with this name already exists");
    }

    // Insert into unsaved rule set
    const id = await ctx.db.insert("appointmentTypes", {
      createdAt: BigInt(Date.now()),
      duration: args.duration,
      lastModified: BigInt(Date.now()),
      name: args.name,
      practiceId: args.practiceId,
      ruleSetId: ruleSetId,
    });

    return id;
  },
});
```

**Example - Update mutation:**

```typescript
export const updateAppointmentType = mutation({
  args: {
    appointmentTypeId: v.id("appointmentTypes"),
    duration: v.optional(v.number()),
    name: v.optional(v.string()),
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Get or create unsaved rule set automatically
    const ruleSetId = await getOrCreateUnsavedRuleSet(ctx.db, args.practiceId);

    // Get the appointment type and validate it belongs to unsaved rule set
    const appointmentType = await ctx.db.get(args.appointmentTypeId);
    if (!appointmentType) {
      throw new Error("Appointment type not found");
    }

    if (appointmentType.ruleSetId !== ruleSetId) {
      throw new Error(
        "Appointment type does not belong to the unsaved rule set",
      );
    }

    // Check name uniqueness if changing name...
    // Update...
  },
});
```

**Queries remain unchanged** - they still take `ruleSetId`:

```typescript
export const getAppointmentTypes = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("appointmentTypes")
      .withIndex("by_ruleSetId", (q) => q.eq("ruleSetId", args.ruleSetId))
      .collect();
  },
});
```

---

### File: `convex/ruleSets.ts`

**Rename and update functions:**

1. **Remove** `createUnsavedRuleSet` mutation (no longer needed - auto-created by entity mutations)

2. **Rename** `saveRuleSet` → `saveUnsavedRuleSet`:

```typescript
export const saveUnsavedRuleSet = mutation({
  args: {
    description: v.string(),
    practiceId: v.id("practices"),
    setAsActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Find the unsaved rule set
    const unsavedRuleSet = await findUnsavedRuleSet(ctx.db, args.practiceId);

    if (!unsavedRuleSet) {
      throw new Error("No unsaved rule set exists for this practice");
    }

    // Validate it's actually unsaved
    if (unsavedRuleSet.saved !== false) {
      throw new Error("Cannot save a rule set that is already saved");
    }

    // Update to saved state
    await ctx.db.patch(unsavedRuleSet._id, {
      description: args.description,
      saved: true,
    });

    // Optionally set as active
    if (args.setAsActive) {
      await ctx.db.patch(unsavedRuleSet._id, {
        isActive: true,
      });

      // Deactivate other rule sets...
    }
  },
});
```

3. **Rename** `deleteUnsavedRuleSet` → `discardUnsavedRuleSet`:

```typescript
export const discardUnsavedRuleSet = mutation({
  args: {
    practiceId: v.id("practices"),
  },
  handler: async (ctx, args) => {
    // Find the unsaved rule set
    const unsavedRuleSet = await findUnsavedRuleSet(ctx.db, args.practiceId);

    if (!unsavedRuleSet) {
      throw new Error("No unsaved rule set exists for this practice");
    }

    // Delete the rule set (entities will cascade via Convex)
    await ctx.db.delete(unsavedRuleSet._id);
  },
});
```

4. **Add** `getRuleSet` query:

```typescript
export const getRuleSet = query({
  args: {
    ruleSetId: v.id("ruleSets"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.ruleSetId);
  },
});
```

5. **Keep** existing queries unchanged:
   - `getUnsavedRuleSet({ practiceId })`
   - `getActiveRuleSet({ practiceId })`
   - `getSavedRuleSets({ practiceId })`
   - `setActiveRuleSet({ practiceId, ruleSetId })`

---

## Frontend Impact (Much Simpler!)

### Old Workflow (Complex):

```tsx
// 1. Check for unsaved
const unsavedRuleSet = useQuery(api.ruleSets.getUnsavedRuleSet, { practiceId });

// 2. Create if needed
if (!unsavedRuleSet) {
  const activeRuleSet = useQuery(api.ruleSets.getActiveRuleSet, { practiceId });
  await createUnsaved({ practiceId, sourceRuleSetId: activeRuleSet._id });
}

// 3. Make changes
await createAppointmentType({
  ruleSetId: unsavedRuleSet._id,
  name: "New Type",
  duration: 30,
  practiceId,
});
```

### New Workflow (Simple):

```tsx
// Just make changes - backend handles unsaved rule set automatically!
await createAppointmentType({
  practiceId,
  name: "New Type",
  duration: 30,
});

// Save when ready
await saveUnsavedRuleSet({
  practiceId,
  description: "Added new appointment type",
  setAsActive: true,
});

// Or discard
await discardUnsavedRuleSet({ practiceId });
```

### Viewing Content (Any Rule Set):

```tsx
// View active rule set
const activeRuleSet = useQuery(api.ruleSets.getActiveRuleSet, { practiceId });
const appointmentTypes = useQuery(api.entities.getAppointmentTypes, {
  ruleSetId: activeRuleSet?._id,
});

// View unsaved rule set (if exists)
const unsavedRuleSet = useQuery(api.ruleSets.getUnsavedRuleSet, { practiceId });
const unsavedAppointmentTypes = useQuery(api.entities.getAppointmentTypes, {
  ruleSetId: unsavedRuleSet?._id,
});

// View any historical rule set (in simulation)
const selectedRuleSet = useQuery(api.ruleSets.getRuleSet, { ruleSetId });
const historicalAppointmentTypes = useQuery(api.entities.getAppointmentTypes, {
  ruleSetId: selectedRuleSet?._id,
});
```

---

## Summary of Changes

### copyOnWrite.ts

- ✅ Add `getOrCreateUnsavedRuleSet()` helper function

### entities.ts

- ✅ Update ALL mutations (create/update/delete for all entities):
  - Remove `ruleSetId` from args
  - Call `getOrCreateUnsavedRuleSet()` to auto-handle unsaved rule set
  - Update validation logic
- ✅ Keep ALL queries unchanged (still take `ruleSetId`)

### ruleSets.ts

- ✅ Remove `createUnsavedRuleSet` mutation (no longer needed)
- ✅ Rename `saveRuleSet` → `saveUnsavedRuleSet`
- ✅ Add validation that `saved === false` in `saveUnsavedRuleSet`
- ✅ Rename `deleteUnsavedRuleSet` → `discardUnsavedRuleSet`
- ✅ Add `getRuleSet({ ruleSetId })` query
- ✅ Keep other queries unchanged

---

## Benefits

1. **Simpler for UI**: Don't need to manage unsaved rule set creation
2. **Fewer queries**: No need to check if unsaved exists before every mutation
3. **Automatic**: Copy-on-write is truly transparent
4. **Flexible viewing**: Can view any rule set's content with `ruleSetId`
5. **Explicit control**: Save/discard are still explicit operations

---

## Migration Checklist

- [ ] Add `getOrCreateUnsavedRuleSet()` to `copyOnWrite.ts`
- [ ] Update all mutations in `entities.ts` (12 mutations total)
- [ ] Update `ruleSets.ts` functions (rename, remove, add)
- [ ] Run `pnpm gen` to regenerate types
- [ ] Fix any TypeScript errors
- [ ] Update frontend components to use new API
- [ ] Test workflow: create → modify → save/discard
