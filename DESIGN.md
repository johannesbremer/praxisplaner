---
name: Praxisplaner
description: Clinical scheduling product UI for patient booking and practice operations.
colors:
  background: "oklch(0.99 0.006 355.69)"
  foreground: "oklch(0.12 0.018 355.69)"
  card: "oklch(1 0.003 355.69)"
  card-foreground: "oklch(0.12 0.018 355.69)"
  popover: "oklch(0.99 0.006 355.69)"
  popover-foreground: "oklch(0.12 0.018 355.69)"
  primary: "oklch(0.6077 0.2484 355.69)"
  primary-text: "oklch(0.36 0.18 355.69)"
  primary-foreground: "oklch(0.12 0.018 355.69)"
  secondary: "oklch(0.95 0.018 355.69)"
  secondary-foreground: "oklch(0.18 0.035 355.69)"
  muted: "oklch(0.97 0.012 355.69)"
  muted-foreground: "oklch(0.4 0.04 355.69)"
  accent: "oklch(0.94 0.04 355.69)"
  accent-foreground: "oklch(0.22 0.07 355.69)"
  destructive: "oklch(0.63 0.19 23.03)"
  destructive-foreground: "oklch(1 0 0)"
  border: "oklch(0.91 0.018 355.69)"
  input: "oklch(0.94 0.018 355.69)"
  ring: "oklch(0.6077 0.2484 355.69)"
  chart-1: "oklch(0.6077 0.2484 355.69)"
  chart-2: "oklch(0.7623 0.1519 229.99)"
  chart-3: "oklch(0.9185 0.2304 127.98)"
  chart-4: "oklch(0.723 0.1897 50.54)"
  chart-5: "oklch(0.46 0.11 285)"
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
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
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

The current implementation is built on shadcn New York primitives with Geist, OKLCH neutral tokens, low-radius controls, compact heights, and a restrained black-and-white base. Future visual work should keep that operational density but move away from generic monochrome SaaS minimalism through sharper corners, stronger hierarchy, and one disciplined poppy accent for signal.

This system rejects generic Vercel-style template polish, over-rounded cards, pill-heavy layouts, decorative gradients, soft ghost-card shadows, playful medical illustrations, and marketing-page composition inside task surfaces.

**Key Characteristics:**

- Product-first density for staff workflows and calm linearity for patient booking.
- Neutral clinical base with exact contrast, stable borders, and clear focus rings.
- Poppy accent used as signal, not decoration.
- Low-radius, precise controls rather than bubbly SaaS softness.
- German healthcare copy that names the object and the consequence.

## 2. Colors

The palette is a magenta-led clinical base with semantic state colors and high-chroma supporting signals. The brand/action color is **Signal Magenta** (`#e80288`, represented as `oklch(0.6077 0.2484 355.69)` in tokens). The product borrows the energetic Luta Security-style contrast of magenta, cyan, lime, and orange, but keeps it restrained enough for healthcare scheduling work.

### Primary

- **Signal Magenta**: The primary action, focus, selected-state, and strongest brand token. Use it for the most important action or current object on a screen. Filled magenta controls use dark ink foreground for AA contrast.
- **Signal Magenta Text**: A darker companion token for small active labels and inline text. Do not use the bright Signal Magenta fill token as 12-14px foreground text on light surfaces.
- **Clinical Ink**: The primary reading color. It remains tinted toward Signal Magenta instead of pure black, keeping the product crisp without returning to grayscale minimalism.

### Secondary

- **Control Rose**: The secondary action and inactive-control layer. It gives controls physical presence while staying visibly related to Signal Magenta.

### Tertiary

- **Signal Cyan**, **Signal Lime**, and **Signal Orange**: Supporting data and status colors. Use them for charts, information, success, and warnings. They should contrast with Signal Magenta, not compete with it in primary actions. Version graph branch colors may use darker branch-specific variants when a chart color is too light for 2px strokes or dots.

### Neutral

- **Clinical Blush White**: The main app background and high-trust patient booking surface, with a minimal magenta tint.
- **Surface White**: Card and content-panel surface, kept nearly white for readability.
- **Soft Signal Panel**: Muted panels, tab lists, skeletons, and non-selected containers with restrained magenta chroma.
- **Rule Border Rose**: Dividers, table lines, field strokes, and calendar grid structure.
- **Readable Muted Ink**: Secondary text. Keep it dark enough for WCAG AA, especially on tinted or muted surfaces.

### Named Rules

**The Signal Rarity Rule.** Signal Magenta must stay rare. If it appears on more than roughly 10% of a product screen, it is no longer signal.

**The Luta Energy Rule.** The app may use sharp magenta/cyan/lime/orange contrast for charts, focus, selected objects, and meaningful state. Do not turn dense product screens into a campaign surface.

**The Clinical Contrast Rule.** Body text, placeholders, labels, and disabled-adjacent explanations must remain readable against their actual surface. Do not soften text into pale gray for elegance.

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

- **Shape:** Low-radius rectangles (6px). Keep buttons crisp, not pill-like.
- **Primary:** Signal Magenta background with dark ink foreground, 36px height, 16px horizontal padding, medium label weight.
- **Hover / Focus:** Hover may reduce opacity or shift the background token slightly. Focus must use the visible 3px ring treatment.
- **Secondary / Ghost / Outline:** Secondary uses Control Gray. Outline uses a border and background surface. Ghost appears only where the surrounding structure already makes the action clear.

### Chips

- **Style:** Badges use 6px radius, compact x-padding, and a text-xs label. Primary badges are for strong status, secondary badges for supporting metadata.
- **State:** Selected or active chips may use the signal accent once it exists. Do not make every metadata tag colorful.

### Cards / Containers

- **Corner Style:** Current cards use 12px radius. Future product work should bias sharper for dense workbench surfaces, reserving 12px for larger patient-facing containers.
- **Background:** Cards use Surface White on Clinical White, with muted panels for nested context.
- **Shadow Strategy:** Use the Flat Workbench Rule. Cards at rest should rely on border and spacing before shadow.
- **Border:** 1px Rule Border Gray for structure.
- **Internal Padding:** 24px for full cards, 12-16px for dense operational modules.

### Inputs / Fields

- **Style:** 36px height, 6px radius, 1px input border, transparent or background surface, 12px horizontal padding.
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
- **Do** use the future poppy accent only for primary action, selection, current context, and meaningful status.
- **Do** keep corners sharp and intentional: 6px for controls, 8-12px for larger containers, never bubbly by default.
- **Do** preserve strong keyboard focus and WCAG 2.2 AA contrast across booking and staff workflows.
- **Do** use borders, tonal panels, and sticky structure to explain scheduling logic before adding visual effects.

### Don't:

- **Don't** ship generic monochrome SaaS minimalism that feels like a default Vercel template with no healthcare-specific judgment.
- **Don't** use over-rounded cards, pill-heavy layouts, decorative gradients, or soft ghost-card shadows.
- **Don't** add playful medical illustrations or marketing-page composition inside task surfaces.
- **Don't** make patients feel they are operating internal practice software.
- **Don't** use side-stripe borders greater than 1px as accent decoration.
- **Don't** use gradient text, glassmorphism as default, or decorative page-load choreography.
