# Error Handling Guidelines

**All errors are now automatically collected with PostHog before being thrown.**

## The Rule: Always Collect First

We have **zero tolerance** for uncollected errors. Every error must go through our tracking system.

## Single Source of Truth

All error handling goes through `src/utils/error-tracking.ts`:

```typescript
import { createAndThrow, captureAndThrow } from "../utils/error-tracking";

// Instead of: throw new Error("Something went wrong");
createAndThrow("Something went wrong", {
  context: "user_creation",
  userId: user.id,
});

// Instead of: throw existingError;
captureAndThrow(existingError, {
  context: "data_processing",
  step: "validation",
});
```

## Core Functions

### `createAndThrow(message, context)`

- Creates a new error with the message
- Captures it with PostHog/logging
- Throws it
- **Use instead of `throw new Error()`**

### `captureAndThrow(error, context)`

- Takes an existing error
- Captures it with PostHog/logging
- Throws it
- **Use instead of `throw existingError`**

### For React Components: `useErrorTracking()`

```typescript
const { createAndThrow, captureAndThrow } = useErrorTracking();
```

## Context is Critical

Always provide meaningful context:

```typescript
createAndThrow("User not found", {
  context: "authentication",
  userId: requestedUserId,
  route: "/api/user",
  timestamp: Date.now(),
});
```

## Works Everywhere

- **Client-side**: Uses PostHog for tracking
- **Server-side** (Convex): Structured console logging
- **Development**: Respects `VITE_ENABLE_POSTHOG_IN_DEV` flag

## Examples

### Convex Functions

```typescript
// convex/locations.ts
import { createAndThrow } from "../src/utils/error-tracking";

export const createLocation = mutation({
  handler: async (ctx, args) => {
    if (existingLocation) {
      createAndThrow(`Location "${args.name}" already exists`, {
        context: "location_creation",
        practiceId: args.practiceId,
        locationName: args.name,
      });
    }
  },
});
```

### React Components

```typescript
import { useErrorTracking } from "../utils/error-tracking";

export function MyComponent() {
  const { createAndThrow } = useErrorTracking();

  const handleSubmit = async (data) => {
    if (!data.email) {
      createAndThrow("Email is required", {
        context: "form_validation",
        form: "user_profile",
      });
    }
  };
}
```

## Migration Complete

The old error handling patterns have been removed. Only use:

- `createAndThrow()` for new errors
- `captureAndThrow()` for existing errors
- `useErrorTracking()` in React components

## Benefits

1. **100% Error Visibility** - Every single error is tracked
2. **Rich Context** - Detailed debugging information
3. **Zero Configuration** - Just import and use
4. **Environment Aware** - Optimal behavior in dev/prod
5. **Single Pattern** - No more inconsistent error handling
