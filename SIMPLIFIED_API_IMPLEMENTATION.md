# Simplified Copy-on-Write API Implementation - Completed ✅

## Summary

Successfully implemented the simplified copy-on-write API as specified in `SIMPLIFIED_API_PLAN.md`. The backend now transparently handles the unsaved rule set creation, making the API much simpler for UI consumers.

## Changes Made

### 1. ✅ `convex/copyOnWrite.ts`

**Added:** `getOrCreateUnsavedRuleSet()` helper function

- Automatically checks if an unsaved rule set exists for a practice
- If not, creates one by copying from the active rule set
- Returns the unsaved rule set ID
- This is the core function that enables transparent copy-on-write

```typescript
export async function getOrCreateUnsavedRuleSet(
  db: DatabaseWriter,
  practiceId: Id<"practices">,
): Promise<Id<"ruleSets">>;
```

### 2. ✅ `convex/entities.ts`

**Updated ALL 12 mutations** to use the new simplified API:

#### Appointment Types (3 mutations)

- `createAppointmentType` - Removed `ruleSetId` arg, added `practiceId`
- `updateAppointmentType` - Removed `ruleSetId` arg, added `practiceId`
- `deleteAppointmentType` - Removed `ruleSetId` arg, added `practiceId`

#### Practitioners (3 mutations)

- `createPractitioner` - Removed `ruleSetId` arg, kept `practiceId`
- `updatePractitioner` - Removed `ruleSetId` arg, added `practiceId`
- `deletePractitioner` - Removed `ruleSetId` arg, added `practiceId`

#### Locations (3 mutations)

- `createLocation` - Removed `ruleSetId` arg, kept `practiceId`
- `updateLocation` - Removed `ruleSetId` arg, added `practiceId`
- `deleteLocation` - Removed `ruleSetId` arg, added `practiceId`

#### Base Schedules (3 mutations)

- `createBaseSchedule` - Removed `ruleSetId` arg, kept `practiceId`
- `updateBaseSchedule` - Removed `ruleSetId` arg, added `practiceId`
- `deleteBaseSchedule` - Removed `ruleSetId` arg, added `practiceId`

**All queries remain unchanged** - they still take `ruleSetId` to view any rule set's content.

### 3. ✅ `convex/ruleSets.ts`

**Removed:**

- `createUnsavedRuleSet` mutation (no longer needed - auto-created by entity mutations)

**Renamed:**

- `saveRuleSet` → `saveUnsavedRuleSet`
  - Now only takes `practiceId` (finds unsaved automatically)
  - Validates that `saved === false` before saving
  - Removed `ruleSetId` from args
- `deleteUnsavedRuleSet` → `discardUnsavedRuleSet`
  - Now only takes `practiceId` (finds unsaved automatically)
  - Removed `ruleSetId` from args

**Kept unchanged:**

- `getUnsavedRuleSet({ practiceId })`
- `getActiveRuleSet({ practiceId })`
- `getSavedRuleSets({ practiceId })`
- `getRuleSet({ ruleSetId })` - already existed
- `setActiveRuleSet({ practiceId, ruleSetId })`

## API Comparison

### Before (Complex)

```typescript
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

### After (Simple) ✅

```typescript
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

## What This Means for the Frontend

### ✅ Benefits

1. **No more manual unsaved rule set management** - It's all automatic
2. **Fewer queries needed** - No need to check if unsaved exists before mutations
3. **Simpler code** - Just pass `practiceId` and make changes
4. **Flexible viewing** - Can still view any rule set's content with `ruleSetId` in queries
5. **Explicit control** - Save/discard are still explicit, intentional operations

### 🔄 Migration Required

Frontend components will need to be updated to:

1. **Remove `ruleSetId` from all mutation calls**
2. **Add `practiceId` to mutation calls that need it**
3. **Update save/discard calls to use new function names**
4. **Remove manual unsaved rule set creation logic**

Example changes needed:

```typescript
// OLD
await createAppointmentType({
  ruleSetId: unsavedRuleSet._id,
  practiceId,
  name,
  duration,
});

// NEW
await createAppointmentType({
  practiceId,
  name,
  duration,
});
```

```typescript
// OLD
await saveRuleSet({
  practiceId,
  ruleSetId: unsavedRuleSet._id,
  description,
  setAsActive: true,
});

// NEW
await saveUnsavedRuleSet({
  practiceId,
  description,
  setAsActive: true,
});
```

## Testing Checklist

- [ ] Test creating entities without manually creating unsaved rule set
- [ ] Test that unsaved rule set is auto-created on first mutation
- [ ] Test that subsequent mutations use the same unsaved rule set
- [ ] Test saving the unsaved rule set
- [ ] Test discarding the unsaved rule set
- [ ] Test that queries still work with `ruleSetId`
- [ ] Test viewing active, unsaved, and historical rule sets
- [ ] Update all frontend components to use new API
- [ ] Run full integration tests

## Next Steps

1. ✅ Backend implementation complete
2. ✅ Types regenerated (`pnpm gen` successful)
3. 🔄 Update frontend components to use new API
4. 🔄 Test the new workflow end-to-end
5. 🔄 Update any documentation or examples

## Notes

- The implementation maintains backward compatibility for queries (they still take `ruleSetId`)
- All validation and error messages have been updated to reflect "unsaved rule set" terminology
- The automatic creation happens atomically - if any part fails, nothing is created
- The new API is more resilient to race conditions since creation is handled server-side
