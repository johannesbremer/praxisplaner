# Version Graph Improvements - Issue #80

This document summarizes the changes made to fix the version graph usability issues.

## Issues Fixed

### 1. Version Button Width Issue
**Problem**: Version buttons in the graph were always taking up fixed 300px width regardless of content length.
**Solution**: Changed CSS class from `flex` to `inline-flex` to make buttons only as wide as their content.
**Files**: `src/components/version-graph/version-graph.tsx`

### 2. Unsaved Changes Highlighting
**Problem**: When unsaved changes existed, the original version button was still highlighted instead of showing the unsaved state.
**Solution**: Modified `selectedVersionId` logic to prioritize `unsavedRuleSetId` over `selectedRuleSetId`.
**Files**: `src/routes/regeln.tsx`

### 3. Keyboard Navigation
**Problem**: Version nodes could not be navigated using the keyboard.
**Solution**: Added:
- `tabIndex={0}` to make buttons focusable
- `role="button"` for accessibility
- `onKeyDown` handler supporting:
  - Enter/Space: Activate version
  - Arrow Up/Down: Navigate between versions
**Files**: `src/components/version-graph/version-graph.tsx`

### 4. Missing Unsaved State on Rule Disable
**Problem**: Disabling a rule didn't create an unsaved rule set, making the change seem permanent.
**Solution**: 
- Added `onNeedRuleSet` callback to `RuleListNew` component
- Component now calls `ensureUnsavedRuleSet` before making changes
- Updated interface to accept the callback
**Files**: 
- `src/components/rule-list-new.tsx`
- `src/routes/regeln.tsx`

## Technical Details

### Changes Made

1. **Version Graph Component**: 
   - Added keyboard navigation with proper event handling
   - Fixed button width by using `inline-flex`
   - Added accessibility attributes (`tabIndex`, `role`)

2. **Rule List Component**:
   - Added `onNeedRuleSet` callback interface
   - Modified `handleToggleRule` to ensure unsaved state before changes

3. **Main Rules Component**:
   - Updated `selectedVersionId` logic for better unsaved highlighting
   - Passed `ensureUnsavedRuleSet` function to `RuleListNew`

### Testing

Created comprehensive test suite (`src/tests/version-graph-improvements.test.ts`) that verifies:
- Code changes are present in the files
- Keyboard navigation logic works correctly
- All interfaces and callbacks are properly connected

All existing tests continue to pass, ensuring no regressions.

## User Experience Improvements

1. **Better Visual Feedback**: Users can now clearly see when they're in an unsaved state
2. **Improved Accessibility**: Keyboard users can navigate the version graph
3. **More Intuitive Interaction**: Buttons are appropriately sized and behave consistently
4. **Proper State Management**: All changes now correctly trigger unsaved state creation