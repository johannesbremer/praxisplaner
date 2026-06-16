---
name: Praxisplaner
description: Clinical scheduling product UI for patient booking and practice operations.
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0.008 326)"
  card: "oklch(1 0 0)"
  card-foreground: "oklch(0.145 0.008 326)"
  popover: "oklch(1 0 0)"
  popover-foreground: "oklch(0.145 0.008 326)"
  primary: "oklch(0.212 0.019 322.12)"
  primary-text: "oklch(0.212 0.019 322.12)"
  primary-foreground: "oklch(0.985 0 0)"
  secondary: "oklch(0.96 0.003 325.6)"
  secondary-foreground: "oklch(0.212 0.019 322.12)"
  muted: "oklch(0.96 0.003 325.6)"
  muted-foreground: "oklch(0.542 0.034 322.5)"
  accent: "oklch(0.96 0.003 325.6)"
  accent-foreground: "oklch(0.212 0.019 322.12)"
  destructive: "oklch(0.577 0.245 27.325)"
  destructive-foreground: "oklch(1 0 0)"
  border: "oklch(0.922 0.005 325.62)"
  input: "oklch(0.922 0.005 325.62)"
  ring: "oklch(0.26 0.025 323.02)"
  chart-1: "oklch(0.897 0.196 126.665)"
  chart-2: "oklch(0.768 0.233 130.85)"
  chart-3: "oklch(0.648 0.2 131.684)"
  chart-4: "oklch(0.532 0.157 131.589)"
  chart-5: "oklch(0.453 0.124 130.933)"
  selection-ring: "oklch(0.46 0.16 230)"
typography:
  display:
    fontFamily: "Geist, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0em"
  headline:
    fontFamily: "Geist, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0em"
  title:
    fontFamily: "Geist, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0em"
  body:
    fontFamily: "Geist, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "Geist, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0em"
  mono:
    fontFamily: "Geist Mono, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
rounded:
  xs: "0px"
  sm: "0px"
  md: "0px"
  lg: "0px"
  xl: "0px"
spacing:
  unit: "4px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  "2xl": "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
    typography: "{typography.label}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
    typography: "{typography.label}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
    typography: "{typography.label}"
  input-default:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "4px 12px"
    typography: "{typography.body}"
  card-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    padding: "24px"
  badge-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "2px 8px"
    typography: "{typography.label}"
---

# Design System: Praxisplaner

## 1. Overview

**Creative North Star: "Clinical Signal Desk"**

Praxisplaner is a clinical product interface for high-trust scheduling work. The system should feel like a precise operations desk: clear surfaces, low visual noise, direct state feedback, and no decorative delay between intent and action.

The current implementation is built on shadcn New York primitives with Geist, a mauve-based shadcn preset, OKLCH tokens, zero-radius controls, compact heights, and a restrained white-and-ink base. Future visual work should keep that operational density while preserving the preset's clean light surface and sharp geometry.

This system rejects generic Vercel-style template polish, over-rounded cards, pill-heavy layouts, decorative gradients, soft ghost-card shadows, playful medical illustrations, and marketing-page composition inside task surfaces.

**Key Characteristics:**

- Product-first density for staff workflows and calm linearity for patient booking.
- Neutral clinical base with exact contrast, stable borders, and clear focus rings.
- Dark mauve primary used for primary actions and active text.
- Sharp, zero-radius controls rather than bubbly SaaS softness.
- German healthcare copy that names the object and the consequence.

## 2. Colors

The palette is a mauve-led clinical base from the shadcn preset, with a clean white background for patient-facing calm. Primary actions use dark mauve/ink rather than saturated pink, keeping them clearly separate from destructive and warning states.

### Primary

- **Mauve Ink**: The primary action, active label, and selected-state token. It is intentionally dark in light mode so buttons and small text pass contrast checks.
- **Primary Text**: A text-safe alias for Mauve Ink. Use it for active/completed progress labels instead of a bright fill color.
- **Clinical Ink**: The primary reading color. It remains subtly mauve-tinted rather than pure black.

### Secondary

- **Control Mauve**: The secondary action and inactive-control layer. It gives controls physical presence while staying visually related to the preset.

### Tertiary

- **Green Chart Ramp**: Supporting data colors from the preset. Use them for charts and non-semantic differentiation. Version graph branch colors may use darker branch-specific variants when a chart color is too light for 2px strokes or dots.

### Neutral

- **Clinical White**: The main app background and high-trust patient booking surface.
- **Surface White**: Card and content-panel surface, kept nearly white for readability.
- **Soft Mauve Panel**: Muted panels, tab lists, skeletons, and non-selected containers with restrained mauve chroma.
- **Rule Border Mauve**: Dividers, table lines, field strokes, and calendar grid structure.
- **Readable Muted Ink**: Secondary text. Keep it dark enough for WCAG AA, especially on tinted or muted surfaces.

### Named Rules

**The Primary Separation Rule.** Primary actions must stay visually distinct from destructive red and warning orange. Do not use saturated pink for default primary buttons.

**The Clinical Contrast Rule.** Body text, placeholders, labels, and disabled-adjacent explanations must remain readable against their actual surface. Do not soften text into pale gray for elegance.

**The Selection Outline Rule.** Selected appointments use the dedicated selection ring token, not the softer info token, so 2px rings remain visible on white surfaces and info-muted fills.

## 3. Typography

**Display Font:** Geist, with sans-serif fallback  
**Body Font:** Geist, with sans-serif fallback  
**Label/Mono Font:** Geist Mono for logs, technical identifiers, imported file traces, and debugging surfaces

**Character:** Geist keeps the product clear, compact, and contemporary without adding a separate brand voice to operational screens. The type system should rely on weight, spacing, and proximity rather than display typography.

### Hierarchy

- **Display** (700, 2.25rem, 1.1): Landing or dashboard-level headings only. Product screens should use this sparingly.
- **Headline** (600, 1.5rem, 1.2): Page and major panel titles.
- **Title** (600, 1rem, 1): Card titles, table region titles, modal titles, and compact section headers.
- **Body** (400, 0.875rem, 1.5): Default copy, field help, descriptions, and patient-facing instructions. Prose should stay within 65-75ch.
- **Label** (500, 0.875rem, 1.25): Buttons, field labels, tabs, compact controls, and navigation items.
- **Mono** (400, 0.875rem, 1.5): GDT logs, technical traces, rule diagnostics, IDs, and imported file details.

### Named Rules

**The Product Type Rule.** Do not introduce display fonts into labels, buttons, tables, forms, or calendar cells. Product UI uses one sans family well.

**The No Fluid UI Type Rule.** Use fixed rem sizes for product UI. Fluid clamp scales belong to marketing surfaces, not dense scheduling tools.

## 4. Elevation

Praxisplaner is flat by default. Depth comes from borders, tonal layers, sticky headers, and compact shadows for overlays or state feedback. Resting cards and controls should not pair visible borders with wide soft shadows.

### Shadow Vocabulary

- **Hairline Lift** (`0px 1px 2px 0px hsl(0 0% 0% / 0.09)`): Minimal lift for buttons, inputs, and compact surfaces that need tactile feedback.
- **Panel Lift** (`0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 2px 4px -1px hsl(0 0% 0% / 0.18)`): Menus, popovers, dialogs, and surfaces that must sit over the task.
- **Strong Overlay Lift** (`0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 8px 10px -1px hsl(0 0% 0% / 0.18)`): Rare overlay or drag state only.

### Named Rules

**The Flat Workbench Rule.** Surfaces are flat at rest. If a shadow is visible from across the room, it is too decorative for this product.

**The No Ghost Card Rule.** Never combine a 1px border with a wide decorative drop shadow. Pick border structure or compact lift, not both.

## 5. Components

### Buttons

- **Shape:** Sharp rectangles. Keep buttons crisp, not pill-like.
- **Primary:** Dark mauve background with light foreground, 36px height, 16px horizontal padding, medium label weight.
- **Hover / Focus:** Hover may reduce opacity or shift the background token slightly. Focus must use the visible 3px ring treatment.
- **Secondary / Ghost / Outline:** Secondary uses Control Gray. Outline uses a border and background surface. Ghost appears only where the surrounding structure already makes the action clear.

### Chips

- **Style:** Badges use the sharp preset radius, compact x-padding, and a text-xs label. Primary badges are for strong status, secondary badges for supporting metadata.
- **State:** Selected or active chips may use the signal accent once it exists. Do not make every metadata tag colorful.

### Cards / Containers

- **Corner Style:** Current containers use the sharp preset radius. Do not reintroduce rounded cards unless a specific component requires it.
- **Background:** Cards use Surface White on Clinical White, with muted panels for nested context.
- **Shadow Strategy:** Use the Flat Workbench Rule. Cards at rest should rely on border and spacing before shadow.
- **Border:** 1px Rule Border Gray for structure.
- **Internal Padding:** 24px for full cards, 12-16px for dense operational modules.

### Inputs / Fields

- **Style:** 36px height, sharp corners, 1px input border, transparent or background surface, 12px horizontal padding.
- **Focus:** Border shifts to ring color with the standard 3px focus ring.
- **Error / Disabled:** Error uses destructive border and ring tint. Disabled controls reduce opacity but must preserve label readability.

### Navigation

- **Style:** Top-level routes and tabs should use compact labels, lucide icons where useful, and active state through weight, background, or signal accent. Sidebars use a second neutral surface with clear hover and active states.
- **Mobile Treatment:** Collapse structural navigation into sheets or stacked controls rather than shrinking labels below readable sizes.

### Scheduling Workbench

Calendar grids, rule diffs, version graphs, and booking simulations are signature surfaces. They may be denser than patient booking, with table-like borders, sticky headers, and compact controls. State color must distinguish actual scheduling facts: availability, absence, blocked slot, occupancy, unresolved appointment, warning, and confirmed action.

## 6. Do's and Don'ts

### Do:

- **Do** keep the default register product-first: dense, calm, and task-oriented.
- **Do** use primary color for primary action, selection, current context, and meaningful status.
- **Do** keep corners sharp and intentional, never bubbly by default.
- **Do** preserve strong keyboard focus and WCAG 2.2 AA contrast across booking and staff workflows.
- **Do** use borders, tonal panels, and sticky structure to explain scheduling logic before adding visual effects.

### Don't:

- **Don't** ship generic monochrome SaaS minimalism that feels like a default Vercel template with no healthcare-specific judgment.
- **Don't** use over-rounded cards, pill-heavy layouts, decorative gradients, or soft ghost-card shadows.
- **Don't** add playful medical illustrations or marketing-page composition inside task surfaces.
- **Don't** make patients feel they are operating internal practice software.
- **Don't** use side-stripe borders greater than 1px as accent decoration.
- **Don't** use gradient text, glassmorphism as default, or decorative page-load choreography.
