# URL State Management Implementation

This document describes the implementation of URL path parameters for state management in the praxisplaner application.

## Overview

The application now uses TanStack Router's optional path parameters to store UI state in URLs, making the application more shareable and bookmarkable while maintaining browser navigation.

## Routes Implemented

### 1. `/praxisplaner` Route

**New Route Structure:** `/praxisplaner/{-$date}/{-$tab}`

**Parameters:**
- `{-$date}` - Optional date parameter (ISO date string, e.g., "2024-01-15")
- `{-$tab}` - Optional tab parameter ("settings" for "Für Nerds" tab)

**URL Examples:**
- `/praxisplaner` - Default calendar view, today's date
- `/praxisplaner/settings` - "Für Nerds" tab active
- `/praxisplaner/2024-01-15` - Calendar view with specific date
- `/praxisplaner/2024-01-15/settings` - "Für Nerds" tab with specific date

**State Stored:**
- Selected date (if not today)
- Active tab (if not "calendar")

### 2. `/regeln` Route

**New Route Structure:** `/regeln/{-$tab}/{-$ruleSet}/{-$patientType}/{-$date}`

**Parameters:**
- `{-$tab}` - Page tab ("staff-view" or "debug-views", default: "rule-management")
- `{-$ruleSet}` - Selected rule set ID for simulation
- `{-$patientType}` - Patient type ("existing", default: "new")
- `{-$date}` - Simulation date (ISO date string)

**URL Examples:**
- `/regeln` - Default rule management view
- `/regeln/staff-view` - Staff view tab
- `/regeln/debug-views` - Debug view tab  
- `/regeln/rule-management/abc123/existing/2024-01-15` - Full state with specific rule set, existing patient, and date
- `/regeln/staff-view/def456` - Staff view with specific rule set

**State Stored:**
- Active page tab
- Selected rule set for simulation
- Patient type (new vs existing)
- Simulation date

## Technical Implementation

### Optional Path Parameters

Uses TanStack Router's `{-$paramName}` syntax for optional parameters:
- Parameters are omitted from URL when at default values
- Creates clean URLs while preserving state
- Maintains backwards compatibility

### Navigation Functions

Each route implements URL update functions that:
1. Only include non-default values in URL parameters
2. Handle proper TypeScript typing for optional parameters
3. Use `void navigate()` for proper async handling

### Backwards Compatibility

Old routes (`/praxisplaner` and `/regeln`) redirect to new parameterized versions:
- `/praxisplaner` → `/praxisplaner/{-$date}/{-$tab}` with empty params
- `/regeln` → `/regeln/{-$tab}/{-$ruleSet}/{-$patientType}/{-$date}` with empty params

## Code Structure

### Route Files
- `src/routes/praxisplaner.tsx` - Redirect to parameterized route
- `src/routes/praxisplaner/{-$date}/{-$tab}.tsx` - Main praxisplaner component
- `src/routes/regeln.tsx` - Redirect to parameterized route
- `src/routes/regeln/{-$tab}/{-$ruleSet}/{-$patientType}/{-$date}.tsx` - Main regeln component

### Key Functions
- `setActiveTab()` - Updates tab state in URL (praxisplaner)
- `updateUrl()` - Generic state update function (regeln)
- Navigation parameter building with proper type handling

## Benefits

1. **Shareable URLs** - Users can share specific application states
2. **Browser Navigation** - Back/forward buttons work correctly
3. **Bookmarkable States** - Complex UI states can be bookmarked
4. **Clean URLs** - Default values are omitted for readability
5. **Type Safety** - Full TypeScript support for route parameters

## Usage

The implementation automatically manages URL state - no additional code needed in most components. State is read from URL parameters on load and updated when user interactions change the UI state.

**Example: Switching to "Für Nerds" tab in praxisplaner**
- URL changes from `/praxisplaner` to `/praxisplaner/settings`
- Page refresh maintains the tab selection
- Shareable link preserves the state

**Example: Configuring simulation in regeln**
- URL changes to `/regeln/debug-views/ruleSet123/existing/2024-01-15`
- All simulation parameters preserved in URL
- Complex state combinations are bookmarkable