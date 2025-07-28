# Path Parameter Testing Guide

This document explains how to test the new path parameter functionality for the `/praxisplaner` and `/regeln` routes.

## Praxisplaner Route: `/praxisplaner/{-$date}/{-$tab}`

### URL Examples to Test:

1. **Default state (today, calendar tab):**
   - URL: `/praxisplaner`
   - Expected: Shows calendar tab with today's date

2. **Calendar tab with specific date:**
   - URL: `/praxisplaner/2024-12-25`
   - Expected: Shows calendar tab with December 25, 2024

3. **Für Nerds tab with today's date:**
   - URL: `/praxisplaner/nerds`
   - Expected: Shows "Für Nerds" tab with today's date

4. **Für Nerds tab with specific date:**
   - URL: `/praxisplaner/2024-06-15/nerds`
   - Expected: Shows "Für Nerds" tab with June 15, 2024

### Testing Steps:
1. Navigate to each URL manually in the browser
2. Verify that the correct tab is active
3. Verify that the correct date is selected (if applicable)
4. Switch tabs and verify the URL updates
5. Change dates (where applicable) and verify the URL updates

## Regeln Route: `/regeln/{-$tab}/{-$ruleSet}/{-$patientType}/{-$date}`

### URL Examples to Test:

1. **Default state (rule-management tab, active rule set, new patient, today):**
   - URL: `/regeln`
   - Expected: Shows "Regelverwaltung + Patientensicht" tab, active rule set, new patient, today's date

2. **Staff view with existing patient:**
   - URL: `/regeln/mitarbeiter/bestand`
   - Expected: Shows "Praxismitarbeiter" tab, active rule set, existing patient, today's date

3. **Debug view with specific rule set:**
   - URL: `/regeln/debug/rule-123`
   - Expected: Shows "Debug Views" tab, rule set "rule-123", new patient, today's date

4. **Complete configuration:**
   - URL: `/regeln/debug/rule-456/bestand/2024-03-15`
   - Expected: Shows "Debug Views" tab, rule set "rule-456", existing patient, March 15, 2024

5. **Staff view with specific date and new patient:**
   - URL: `/regeln/mitarbeiter/2024-07-04`
   - Expected: Shows "Praxismitarbeiter" tab, active rule set, new patient, July 4, 2024

### Testing Steps:
1. Navigate to each URL manually in the browser
2. Verify that the correct tab is active
3. Verify that the correct rule set is selected in Simulation Controls
4. Verify that the correct patient type is selected (new vs existing)
5. Verify that the correct date is selected
6. Change any of these settings and verify the URL updates accordingly

## Parameter Mapping Reference

### Praxisplaner Parameters:
- **Date**: `YYYY-MM-DD` format, omitted if today
- **Tab**: `nerds` for "Für Nerds" tab, omitted for calendar (default)

### Regeln Parameters:
- **Tab**: `mitarbeiter` for "Praxismitarbeiter", `debug` for "Debug Views", omitted for "Regelverwaltung + Patientensicht" (default)
- **Rule Set**: Rule set ID as string, omitted for active rule set
- **Patient Type**: `bestand` for existing patients, omitted for new patients (default)
- **Date**: `YYYY-MM-DD` format, omitted if today

## Backward Compatibility Testing

1. **Old praxisplaner URL:**
   - Navigate to `/praxisplaner` (without path parameters)
   - Should automatically redirect to `/praxisplaner` with default parameters

2. **Old regeln URL:**
   - Navigate to `/regeln` (without path parameters)
   - Should automatically redirect to `/regeln` with default parameters

## Browser Navigation Testing

1. **Forward/Back navigation:**
   - Navigate through different parameter combinations
   - Use browser back/forward buttons
   - Verify that the state is restored correctly

2. **Bookmarking:**
   - Bookmark URLs with specific parameters
   - Close and reopen browser
   - Navigate to bookmarked URLs and verify correct state restoration

3. **Direct URL access:**
   - Copy URLs with parameters from the address bar
   - Open in new tab/window
   - Verify that the state is loaded correctly

## Error Handling Testing

1. **Invalid dates:**
   - `/praxisplaner/invalid-date`
   - Should default to today's date

2. **Invalid parameters:**
   - `/praxisplaner/invalid-tab`
   - Should default to calendar tab

3. **Mixed valid/invalid parameters:**
   - `/regeln/invalid-tab/valid-rule-id/bestand/2024-03-15`
   - Should use valid parameters and default for invalid ones

## Automated Testing

The path parameter functionality is covered by automated tests in:
- `src/tests/path-parameters.test.ts`

Run tests with:
```bash
pnpm test src/tests/path-parameters.test.ts
```

The tests cover:
- Date formatting and parsing
- Tab parameter mapping
- Patient type parameter mapping
- Bidirectional parameter conversion
- URL construction scenarios
- Edge cases and error handling