# Frontend Migration Guide - Copy-on-Write API

## Overview

The backend has been refactored to use a copy-on-write pattern for versioned entities. This requires updating all frontend components that interact with appointment types, practitioners, locations, and base schedules.

## Breaking Changes

### Deleted Files (Old API)

- `convex/appointmentTypes.ts` ❌
- `convex/practitioners.ts` ❌
- `convex/locations.ts` ❌
- `convex/baseSchedules.ts` ❌

### New Unified API

- `convex/entities.ts` ✅ (all CRUD operations)
- `convex/ruleSets.ts` ✅ (rule set management)
- `convex/copyOnWrite.ts` ✅ (internal infrastructure)

## Migration Steps

### 1. Update Imports

**Old:**

```tsx
import { api } from "../convex/_generated/api";

// These no longer exist:
const appointmentTypes = useQuery(api.appointmentTypes.getAppointmentTypes, {...});
const practitioners = useQuery(api.practitioners.getPractitioners, {...});
const locations = useQuery(api.locations.getLocations, {...});
const schedules = useQuery(api.baseSchedules.getAllBaseSchedules, {...});
```

**New:**

```tsx
import { api } from "../convex/_generated/api";

// All entities are now in api.entities:
const appointmentTypes = useQuery(api.entities.getAppointmentTypes, {
  ruleSetId,
});
const practitioners = useQuery(api.entities.getPractitioners, { ruleSetId });
const locations = useQuery(api.entities.getLocations, { ruleSetId });
const schedules = useQuery(api.entities.getBaseSchedules, { ruleSetId });
```

### 2. Implement Copy-on-Write Workflow

All modifications now follow this pattern:

#### A. Check for Unsaved Rule Set

```tsx
const unsavedRuleSet = useQuery(api.ruleSets.getUnsavedRuleSet, { practiceId });
```

#### B. Create Unsaved Copy (if needed)

```tsx
const createUnsaved = useMutation(api.ruleSets.createUnsavedRuleSet);

// When user starts editing:
if (!unsavedRuleSet) {
  const activeRuleSet = useQuery(api.ruleSets.getActiveRuleSet, { practiceId });
  await createUnsaved({
    practiceId,
    sourceRuleSetId: activeRuleSet._id,
  });
}
```

#### C. Make Changes (to unsaved rule set)

```tsx
const createAppointmentType = useMutation(api.entities.createAppointmentType);

await createAppointmentType({
  ruleSetId: unsavedRuleSet._id,
  name: "Neue Terminart",
  duration: 30,
  practiceId,
});
```

#### D. Save or Discard

```tsx
const saveRuleSet = useMutation(api.ruleSets.saveRuleSet);
const deleteUnsaved = useMutation(api.ruleSets.deleteUnsavedRuleSet);

// Save:
await saveRuleSet({
  ruleSetId: unsavedRuleSet._id,
  description: "Updated appointment types",
  practiceId,
  setAsActive: true,
});

// Or discard:
await deleteUnsaved({
  ruleSetId: unsavedRuleSet._id,
  practiceId,
});
```

### 3. Updated Mutation Names

| Old API                                          | New API                                   |
| ------------------------------------------------ | ----------------------------------------- |
| `appointmentTypes.createAppointmentType`         | `entities.createAppointmentType`          |
| `appointmentTypes.updateAppointmentType`         | `entities.updateAppointmentType`          |
| `appointmentTypes.deleteAppointmentType`         | `entities.deleteAppointmentType`          |
| `appointmentTypes.getAppointmentTypes`           | `entities.getAppointmentTypes`            |
| `appointmentTypes.createAppointmentTypeDuration` | ❌ Removed (use `duration` field)         |
| `appointmentTypes.updateAppointmentTypeDuration` | ❌ Removed (use `duration` field)         |
| `practitioners.createPractitioner`               | `entities.createPractitioner`             |
| `practitioners.updatePractitioner`               | `entities.updatePractitioner`             |
| `practitioners.deletePractitioner`               | `entities.deletePractitioner`             |
| `practitioners.getPractitioners`                 | `entities.getPractitioners`               |
| `locations.createLocation`                       | `entities.createLocation`                 |
| `locations.updateLocation`                       | `entities.updateLocation`                 |
| `locations.deleteLocation`                       | `entities.deleteLocation`                 |
| `locations.getLocations`                         | `entities.getLocations`                   |
| `baseSchedules.createBaseSchedule`               | `entities.createBaseSchedule`             |
| `baseSchedules.updateBaseSchedule`               | `entities.updateBaseSchedule`             |
| `baseSchedules.deleteBaseSchedule`               | `entities.deleteBaseSchedule`             |
| `baseSchedules.getAllBaseSchedules`              | `entities.getBaseSchedules`               |
| `baseSchedules.getBaseSchedulesByPractitioner`   | `entities.getBaseSchedulesByPractitioner` |

### 4. Schema Changes

#### Appointment Types

**Old:**

- Duration stored in separate `appointmentTypeDurations` table
- Multiple durations per appointment type with different practitioners

**New:**

- Single `duration` field on `appointmentTypes` table
- No more separate durations table

**Migration:**

```tsx
// Old:
const appointmentType = {
  _id: "...",
  name: "Erstuntersuchung",
  // duration was in separate table
};

// New:
const appointmentType = {
  _id: "...",
  name: "Erstuntersuchung",
  duration: 30, // in minutes, now directly on the type
  ruleSetId: "...",
  practiceId: "...",
};
```

#### Rule Sets

**Old:**

```tsx
const ruleSet = {
  _id: "...",
  description: "Version 1.0",
  createdBy: "user@example.com",
  // ...
};
```

**New:**

```tsx
const ruleSet = {
  _id: "...",
  description: "Version 1.0",
  saved: true, // or false for unsaved drafts
  practiceId: "...",
  // ...
};
```

### 5. Required Parameters

All entity mutations now require:

- `ruleSetId`: The unsaved rule set to modify
- `practiceId`: For validation

Example:

```tsx
await createAppointmentType({
  ruleSetId: unsavedRuleSet._id,
  name: "Neue Terminart",
  duration: 30,
  practiceId: currentPractice._id,
});
```

### 6. Error Handling

The new API throws descriptive errors:

- `"Cannot modify a saved rule set..."` - Attempting to modify a saved rule set
- `"Rule set does not belong to this practice"` - Wrong practiceId
- `"An unsaved rule set already exists..."` - Trying to create when one exists
- `"Appointment type with this name already exists..."` - Name uniqueness

Handle these appropriately:

```tsx
try {
  await createAppointmentType({...});
} catch (error) {
  if (error.message.includes("already exists")) {
    toast.error("Ein unsaved rule set existiert bereits");
  } else {
    toast.error("Fehler beim Erstellen");
  }
}
```

## Files That Need Updates

Based on lint errors, these files need migration:

1. ✅ `/src/components/appointment-types-management.tsx` - Update to use `entities.ts` API
2. ✅ `/src/components/base-schedule-management.tsx` - Update to use `entities.ts` API
3. ✅ `/src/components/locations-management.tsx` - Update to use `entities.ts` API
4. ✅ `/src/components/practitioner-management.tsx` - Update to use `entities.ts` API
5. ✅ `/src/components/version-history.tsx` - Update to use `ruleSets.ts` API
6. ✅ `/src/components/calendar/use-calendar-logic.ts` - Update queries
7. ✅ `/src/components/csv-import.tsx` - Update mutations
8. ✅ `/src/components/debug-view.tsx` - Update queries
9. ✅ `/src/components/new-calendar.tsx` - Update queries
10. ✅ `/src/components/patient-focused-view.tsx` - Update queries
11. ✅ `/src/components/rule-creation-form-new.tsx` - Update to use new API
12. ✅ `/src/routes/praxisplaner.tsx` - Update queries
13. ✅ `/src/routes/regeln.tsx` - Update to use `ruleSets.ts` API

## Testing Strategy

After migration:

1. **Unit Tests**: Update tests to mock new API endpoints
2. **Integration Tests**: Test full copy-on-write workflow
3. **E2E Tests**: Verify UI correctly creates/saves/discards rule sets

## Quick Reference: Full Workflow Example

```tsx
function AppointmentTypeEditor() {
  const practiceId = useCurrentPractice();

  // 1. Check for unsaved rule set
  const unsavedRuleSet = useQuery(api.ruleSets.getUnsavedRuleSet, {
    practiceId,
  });
  const activeRuleSet = useQuery(api.ruleSets.getActiveRuleSet, { practiceId });

  // 2. Load data from appropriate rule set
  const ruleSetId = unsavedRuleSet?._id ?? activeRuleSet?._id;
  const appointmentTypes = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });

  // 3. Mutations
  const createUnsaved = useMutation(api.ruleSets.createUnsavedRuleSet);
  const createType = useMutation(api.entities.createAppointmentType);
  const save = useMutation(api.ruleSets.saveRuleSet);
  const discard = useMutation(api.ruleSets.deleteUnsavedRuleSet);

  const handleEdit = async () => {
    // Create unsaved copy if needed
    let targetRuleSetId = unsavedRuleSet?._id;
    if (!targetRuleSetId) {
      targetRuleSetId = await createUnsaved({
        practiceId,
        sourceRuleSetId: activeRuleSet._id,
      });
    }

    // Make changes
    await createType({
      ruleSetId: targetRuleSetId,
      name: "New Type",
      duration: 30,
      practiceId,
    });
  };

  const handleSave = async () => {
    if (!unsavedRuleSet) {
      return;
    }

    await save({
      ruleSetId: unsavedRuleSet._id,
      description: "Updated appointment types",
      practiceId,
      setAsActive: true,
    });
  };

  const handleDiscard = async () => {
    if (!unsavedRuleSet) {
      return;
    }

    await discard({
      ruleSetId: unsavedRuleSet._id,
      practiceId,
    });
  };

  return (
    <div>
      {unsavedRuleSet && (
        <div className="alert">
          Unsaved changes exist!
          <button onClick={handleSave}>Save</button>
          <button onClick={handleDiscard}>Discard</button>
        </div>
      )}
      {/* ... */}
    </div>
  );
}
```

## Rollback Plan

If issues arise:

1. Revert to commit before refactoring
2. Or recreate old API files as wrappers around new API (temporary)
3. Gradual migration: Keep both APIs temporarily with deprecation warnings
