# Copy-on-Write Refactoring Summary

## Overview

Successfully implemented a comprehensive copy-on-write (CoW) system for versioned entities in the Praxisplaner Convex backend.

## What Was Changed

### 1. Schema Updates (`convex/schema.ts`)

- **Removed**: `appointmentTypeDurations` table (consolidated into appointmentTypes)
- **Modified appointmentTypes**: Added `duration: v.number()` field
- **Added practiceId**: To `appointments`, `patients`, and `baseSchedules` tables
- **Modified ruleSets**:
  - Replaced `createdBy: v.string()` with `saved: v.boolean()`
  - Added index `"by_practiceId_saved"` for efficient querying

### 2. Core Infrastructure (`convex/copyOnWrite.ts`)

Created reusable copy-on-write utilities:

- `validateRuleSet()`: Validates rule set exists and belongs to practice
- `ensureUnsavedRuleSet()`: Enforces that only unsaved rule sets can be modified
- `findUnsavedRuleSet()`: Finds existing unsaved rule set for a practice
- `copyAppointmentTypes()`: Copies appointment types with ID mapping
- `copyPractitioners()`: Copies practitioners with ID mapping
- `copyLocations()`: Copies locations with ID mapping
- `copyBaseSchedules()`: Copies schedules preserving relationships
- `copyRules()`: Copies rules to new rule set
- `copyAllEntities()`: Main atomic operation for complete entity copying

### 3. RuleSets Workflow (`convex/ruleSets.ts`)

Completely rewritten with new copy-on-write pattern:

#### Entry Point

- `createUnsavedRuleSet(practiceId, sourceRuleSetId)`:
  - Checks for existing unsaved rule set
  - Creates new rule set with `saved: false`
  - Sets description to "Ungespeicherte Änderungen"
  - Atomically copies all entities from source

#### Exit Point

- `saveRuleSet(ruleSetId, description, practiceId, setAsActive?)`:
  - Validates rule set is unsaved
  - Sets `saved: true`
  - Updates description
  - Optionally sets as active rule set

#### Discard Changes

- `deleteUnsavedRuleSet(ruleSetId, practiceId)`:
  - Deletes unsaved rule set
  - Cascades deletion to all associated entities

#### Query Functions

- `getUnsavedRuleSet(practiceId)`: Returns current unsaved rule set
- `getSavedRuleSets(practiceId)`: Returns all saved rule sets
- `getRuleSet(ruleSetId)`: Returns specific rule set
- `getActiveRuleSet(practiceId)`: Returns currently active rule set
- `setActiveRuleSet(practiceId, ruleSetId)`: Sets active rule set

### 4. Entities API (`convex/entities.ts`)

New unified API for entity management with CRUD operations:

#### Appointment Types

- `createAppointmentType()`: Create with duration in same table
- `updateAppointmentType()`: Update name or duration
- `deleteAppointmentType()`: Delete from unsaved rule set
- `getAppointmentTypes()`: Query by rule set

#### Practitioners

- `createPractitioner()`: Create with optional tags
- `updatePractitioner()`: Update name or tags
- `deletePractitioner()`: Delete with cascade to schedules
- `getPractitioners()`: Query by rule set

#### Locations

- `createLocation()`: Create location
- `updateLocation()`: Update name
- `deleteLocation()`: Delete with cascade to schedules
- `getLocations()`: Query by rule set

#### Base Schedules

- `createBaseSchedule()`: Create with practitioner/location validation
- `updateBaseSchedule()`: Update any schedule properties
- `deleteBaseSchedule()`: Delete schedule
- `getBaseSchedules()`: Query by rule set
- `getBaseSchedulesByPractitioner()`: Query by practitioner

All mutations enforce:

- Unsaved rule set requirement via `ensureUnsavedRuleSet()`
- Practice ownership validation
- Name uniqueness within rule sets
- Relationship integrity (practitioner/location belong to same rule set)

### 5. Deleted Files

Old entity-specific files removed (logic consolidated into `entities.ts`):

- `appointmentTypes.ts`
- `practitioners.ts`
- `locations.ts`
- `baseSchedules.ts`

### 6. Bug Fixes

- Fixed `appointments.ts`: Added `practiceId` to `createAppointment` mutation
- Fixed `patients.ts`: Added `practiceId` to `createOrUpdatePatient` mutation
- Fixed `gdt/processing.ts`: Updated `extractPatientData` to omit `practiceId` from return type

## Key Design Principles

### Atomic Operations

All multi-step operations (copy + modify) happen within a single mutation for data consistency.

### Immutability

Saved rule sets (saved=true) are immutable. Only unsaved rule sets (saved=false) can be modified.

### Single Unsaved Rule Set

Only one unsaved rule set is allowed per practice at a time.

### Type Safety

Full TypeScript type safety using Convex's `GenericDatabaseReader/Writer`, `Doc<T>`, and `Id<T>`.

### Validation First

All mutations validate:

1. Rule set is unsaved (for modifications)
2. Rule set belongs to practice
3. Entities belong to correct rule set
4. Name uniqueness within rule sets

## Workflow Example

```typescript
// 1. User starts editing (creates unsaved copy)
const unsavedRuleSetId = await createUnsavedRuleSet(
  practiceId,
  activeRuleSetId,
);
// -> Creates rule set with saved=false, description="Ungespeicherte Änderungen"
// -> Copies all entities atomically

// 2. User makes changes (all modifications to unsaved rule set)
await createAppointmentType({
  ruleSetId: unsavedRuleSetId,
  name: "Neue Terminart",
  duration: 30,
  practiceId,
});

// 3. User saves changes (makes rule set immutable)
await saveRuleSet(
  unsavedRuleSetId,
  "Version 2.0 - Added new appointment type",
  practiceId,
  true, // Set as active
);
// -> Sets saved=true, updates description, sets as active

// OR user discards changes
await deleteUnsavedRuleSet(unsavedRuleSetId, practiceId);
// -> Deletes rule set and all associated entities
```

## Testing & Validation

✅ All TypeScript compilation errors resolved  
✅ Convex types regenerated successfully (`pnpm gen`)  
✅ Core files (`entities.ts`, `ruleSets.ts`, `copyOnWrite.ts`) error-free  
✅ Schema changes validated  
✅ Multi-tenancy support (practiceId) added consistently

## Migration Notes

### Breaking Changes

1. `appointmentTypeDurations` table no longer exists
2. `appointmentTypes` now has `duration` field directly
3. `ruleSets.createdBy` replaced with `ruleSets.saved`
4. Old entity files (`appointmentTypes.ts`, etc.) removed

### Database Migration Required

When deploying, ensure:

1. Data migration from `appointmentTypeDurations` to `appointmentTypes.duration`
2. Conversion of `ruleSets.createdBy` to `ruleSets.saved` (likely all existing = true)
3. Addition of `practiceId` to existing `appointments`, `patients`, `baseSchedules`

## Files Created

- `convex/copyOnWrite.ts` - Core CoW infrastructure
- `convex/entities.ts` - Unified entity API
- `REFACTORING_SUMMARY.md` - This document

## Files Modified

- `convex/schema.ts` - Schema updates
- `convex/ruleSets.ts` - Complete rewrite
- `convex/appointments.ts` - Added practiceId
- `convex/patients.ts` - Added practiceId
- `convex/gdt/processing.ts` - Type fix
- `convex/tsconfig.json` - Excluded backup files

## Next Steps

1. **Frontend Updates**: Update UI to use new API:
   - Replace calls to old entity endpoints
   - Implement unsaved changes indicator
   - Add save/discard UI controls

2. **Data Migration**: Create migration script for existing data:
   - Migrate appointmentTypeDurations to appointmentTypes.duration
   - Set all existing ruleSets to saved=true
   - Add practiceId to existing records

3. **Testing**: Write comprehensive tests for:
   - Copy-on-write workflow
   - Entity CRUD operations
   - Validation and error cases
   - Concurrent modification scenarios

4. **Documentation**: Update API documentation with new endpoints and workflow
