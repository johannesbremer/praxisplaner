# URL Parameter Structure Diagram

```
📁 Application Routes with URL State Management

┌─ /praxisplaner/{-$date}/{-$tab}
│  ├─ /praxisplaner                          → Default (calendar tab, today)
│  ├─ /praxisplaner/settings                 → "Für Nerds" tab active
│  ├─ /praxisplaner/2024-01-15               → Specific date selected
│  └─ /praxisplaner/2024-01-15/settings      → Specific date + "Für Nerds" tab
│
└─ /regeln/{-$tab}/{-$ruleSet}/{-$patientType}/{-$date}
   ├─ /regeln                                       → Default (rule-management tab)
   ├─ /regeln/staff-view                            → Staff view tab
   ├─ /regeln/debug-views                           → Debug view tab
   ├─ /regeln/rule-management/abc123                → With specific rule set
   ├─ /regeln/staff-view/def456/existing            → Staff view + rule set + existing patient
   └─ /regeln/debug-views/ghi789/existing/2024-01-15 → Full state configuration

📋 Parameter Meanings:

{-$date}        → ISO date string (2024-01-15) | omitted if today
{-$tab}         → Tab identifier | omitted if default tab
{-$ruleSet}     → Rule set ID for simulation | omitted if default/none
{-$patientType} → "existing" | omitted if "new" (default)

🔄 State Management Flow:

User Action → Component State Update → URL Parameter Update → Browser History
     ↑                                                              ↓
Page Load ← Component State Sync ← URL Parameter Read ← Browser Navigation

📊 Examples of State Persistence:

1. User selects "Für Nerds" tab in praxisplaner
   /praxisplaner → /praxisplaner/settings

2. User changes simulation date in regeln  
   /regeln/debug-views → /regeln/debug-views/2024-02-15

3. User configures complex simulation
   /regeln → /regeln/debug-views/ruleSet456/existing/2024-02-15

4. User shares URL with colleague
   Colleague opens URL → All state restored exactly as shared
```