# Rules Engine Documentation

This document provides an overview of the Rules Engine implementation for the Praxisplaner application.

## Overview

The Rules Engine is a flexible, database-backed system that dynamically generates appointment availability based on configurable rules. It replaces static appointment slots with a rules-based approach that can handle complex scheduling scenarios.

## Key Features

### 1. Rule-Based Slot Generation
- Rules define conditions and actions that modify appointment availability
- Rules can be prioritized and applied sequentially
- Support for multiple rule types: conditional availability, seasonal rules, time blocks, resource constraints

### 2. Database-Backed Configuration
- Rules are stored in Convex database with full versioning support
- Copy-on-write versioning ensures historical configurations are preserved
- Practice-specific rule management

### 3. Patient Context Awareness
- Rules can consider patient type (new vs. existing)
- Medical history integration
- Assigned doctor preferences
- Visit history

### 4. Debug and Testing Tools
- Interactive simulation interface (`/sim` route)
- Rule trace functionality showing which rules were applied
- Sample patient contexts and appointment types for testing

## Database Schema

### Core Tables

1. **practices**: Practice management and settings
2. **ruleConfigurations**: Versioned rule sets (copy-on-write)
3. **rules**: Individual rules within configurations
4. **baseAvailability**: Doctor schedules and base availability
5. **appointmentTypes**: Available appointment types and configurations

### Indexes
- Optimized for practice-specific queries
- Priority-based rule retrieval
- Version-based configuration lookup

## Rule Types and Actions

### Rule Types
- `CONDITIONAL_AVAILABILITY`: Rules based on patient/appointment conditions
- `SEASONAL_AVAILABILITY`: Time-based rules (date ranges, seasons)
- `TIME_BLOCK`: Specific time slot management
- `RESOURCE_CONSTRAINT`: Resource-based limitations

### Available Actions
- **Extra Time**: Add additional minutes to appointments
- **Limit Per Day**: Restrict number of appointments per doctor/day
- **Batch Appointments**: Group appointments together
- **Block Time Slots**: Prevent specific times from being available
- **Require Specific Doctor**: Force assignment to particular doctor

### Conditions
- **Appointment Type**: Filter by appointment type
- **Patient Type**: New vs. existing patients
- **Date Range**: Seasonal or campaign-based rules
- **Day of Week**: Weekday restrictions
- **Time Range**: Hour-based filtering
- **Required Resources**: Equipment or room requirements

## Usage Examples

### Basic Rule Creation
```typescript
const rule: Rule = {
  id: "new-patient-rule",
  name: "New Patient Extra Time",
  type: "CONDITIONAL_AVAILABILITY",
  priority: 1,
  active: true,
  conditions: {
    patientType: "new",
    appointmentType: "Erstberatung"
  },
  actions: {
    requireExtraTime: true,
    extraMinutes: 15,
    limitPerDay: 3
  }
};
```

### Using the Rules Engine
```typescript
import { RulesEngine } from "~/lib/rules-engine";

// Initialize with rules from database
const engine = new RulesEngine(rulesFromDatabase);

// Generate slots for a specific scenario
const result = engine.generateAvailableSlots(
  baseSlots,
  "Erstberatung",
  patientContext,
  new Date()
);

// Access applied rules and final slots
console.log(result.appliedRules);
console.log(result.slots);
console.log(result.ruleTrace); // For debugging
```

## Convex Functions

### Rule Management
- `getRulesForConfiguration`: Get all rules for a configuration
- `createRule`: Create a new rule
- `updateRule`: Modify existing rule
- `deleteRule`: Remove a rule
- `toggleRuleActive`: Enable/disable a rule

### Configuration Management
- `getRuleConfigurations`: List all configurations for a practice
- `createRuleConfiguration`: Create new configuration version
- `activateRuleConfiguration`: Switch active configuration

### Slot Generation
- `generateAvailableSlots`: Main function for slot generation
- `simulateSlotGeneration`: Debug function with detailed tracing

## Testing and Debugging

### Simulation Interface
Access the simulation interface at `/sim` to:
- Test different patient contexts
- Try various appointment types
- See rule application in real-time
- Debug rule configurations

### Unit Tests
Run tests with `npm test` to validate:
- Rule application logic
- Date range handling
- Priority ordering
- Patient context filtering

## Integration with UI

### Logic View (`/regeln`)
- Create and edit rules
- Manage rule priorities
- Enable/disable rules
- View rule configurations

### Version Management (`/version`)
- View configuration history
- Activate previous versions
- Create new configuration versions

### Debug View (`/sim`)
- Test rule scenarios
- Validate configurations
- Debug rule application

## Performance Considerations

- Rules are sorted by priority once and cached
- Database indexes optimize rule retrieval
- Slot generation uses efficient filtering
- Memory-efficient rule application

## Best Practices

1. **Rule Priority**: Assign priorities thoughtfully (lower number = higher priority)
2. **Rule Naming**: Use descriptive names for easy identification
3. **Testing**: Always test new rules in simulation before activation
4. **Versioning**: Create new versions when making significant changes
5. **Documentation**: Document complex rule logic for future reference

## Future Enhancements

Potential areas for expansion:
- Resource scheduling integration
- Advanced batch appointment logic
- Machine learning for slot optimization
- Integration with external calendar systems
- Advanced reporting and analytics

## Troubleshooting

### Common Issues
1. **Rules not applying**: Check rule conditions and patient context
2. **Unexpected slot count**: Verify rule actions and limitations
3. **Performance issues**: Review rule complexity and database indexes

### Debug Tools
- Use the simulation interface for interactive testing
- Check rule trace output for detailed application logic
- Validate rule conditions against patient context
- Review database queries for performance issues

This Rules Engine provides a robust foundation for complex appointment scheduling while maintaining flexibility and ease of use.