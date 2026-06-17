---
name: Praxisplaner
description: Clinical scheduling product UI for patient booking and practice operations.
colors:
  background: "oklch(0.9399 0.0203 345.6985)"
  foreground: "oklch(0.4712 0 0)"
  card: "oklch(0.9498 0.05 86.8891)"
  card-foreground: "oklch(0.4712 0 0)"
  popover: "oklch(1 0 0)"
  popover-foreground: "oklch(0.4712 0 0)"
  primary: "oklch(0.58 0.1801 348.1385)"
  primary-text: "oklch(0.4712 0 0)"
  primary-foreground: "oklch(1 0 0)"
  secondary: "oklch(0.8095 0.0694 198.1863)"
  secondary-foreground: "oklch(0.3211 0 0)"
  muted: "oklch(0.88 0.0504 212.0952)"
  muted-foreground: "oklch(0.4712 0 0)"
  accent: "oklch(0.9195 0.0801 87.667)"
  accent-foreground: "oklch(0.3211 0 0)"
  destructive: "oklch(0.52 0.18 21.9551)"
  destructive-foreground: "oklch(1 0 0)"
  border: "oklch(0.58 0.1801 348.1385)"
  input: "oklch(0.9189 0 0)"
  ring: "oklch(0.3 0.12 350.7532)"
  chart-1: "oklch(0.7002 0.1597 350.7532)"
  chart-2: "oklch(0.8189 0.0799 212.0892)"
  chart-3: "oklch(0.9195 0.0801 87.667)"
  chart-4: "oklch(0.7998 0.111 348.1791)"
  chart-5: "oklch(0.6197 0.1899 353.9091)"
  selection-ring: "oklch(0.46 0.16 230)"
typography:
  display:
    fontFamily: "Poppins, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0em"
  headline:
    fontFamily: "Poppins, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0em"
  title:
    fontFamily: "Poppins, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0em"
  body:
    fontFamily: "Poppins, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "Poppins, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0em"
  mono:
    fontFamily: "Fira Code, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
rounded:
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "6px"
  xl: "8px"
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

**Creative North Star: "Playful Clinical Desk"**

Praxisplaner is a clinical product interface for high-trust scheduling work. The system should feel like a precise operations desk with more personality: blush app surfaces, lemon panels, blue secondary controls, direct state feedback, and no decorative delay between intent and action.

The current implementation is built on shadcn New York primitives with a Poppins/Lora/Fira Code type pairing, OKLCH tokens, compact heights, sharp-ish corners, and blocky rose shadows. Future visual work should keep the product density while preserving strong contrast and clear operational states.

This system rejects generic Vercel-style template polish, over-rounded cards, pill-heavy layouts, decorative gradients, soft ghost-card shadows, playful medical illustrations, and marketing-page composition inside task surfaces.

**Key Characteristics:**

- Product-first density for staff workflows and calm linearity for patient booking.
- Blush-and-lemon base with exact contrast, stable borders, and clear focus rings.
- Rose primary, powder-blue secondary, and lemon accent used with restraint for actions and state.
- Compact 0.4rem controls with crisp geometry rather than bubbly SaaS softness.
- German healthcare copy that names the object and the consequence.

## 2. Colors

The palette is a playful rose, lemon, and powder-blue preset on a blush clinical base. Because the source preset is bright, the app uses darker companion tokens where needed to keep normal-size text, focus rings, and thin selected-state outlines accessible.

### Primary

- **Signal Rose**: The primary action and selected-state fill token. It is slightly darker than the pasted preset so white button text clears contrast.
- **Primary Text**: A text-safe neutral companion for small active labels and booking-progress text.
- **Clinical Ink**: The primary reading color, kept neutral enough to sit cleanly on blush, lemon, and white surfaces.

### Secondary

- **Powder Blue**: The secondary action and inactive-control layer. It gives controls physical presence without competing with the rose primary.

### Tertiary

- **Rose, Blue, Lemon, Coral, and Magenta Chart Set**: Supporting data colors from the preset. Use them for charts and non-semantic differentiation. Version graph branch colors may use darker branch-specific variants when a chart color is too light for 2px strokes or dots.

### Neutral

- **Blush Field**: The main app background and high-trust patient booking surface.
- **Lemon Surface**: Card and content-panel surface. Use it deliberately so dense staff tools do not become visually noisy.
- **Powder Panel**: Muted panels, tab lists, skeletons, and non-selected containers with restrained blue chroma.
- **Rose Rule**: Dividers, table lines, field strokes, and calendar grid structure.
- **Readable Muted Ink**: Secondary text. Keep it dark enough for WCAG AA, especially on tinted or muted surfaces.

### Named Rules

**The Primary Contrast Rule.** Signal Rose may be used as a fill with white foreground text. Small text that is not inside the fill should use the text-safe primary text token rather than reusing rose as foreground.

**The Clinical Contrast Rule.** Body text, placeholders, labels, disabled-adjacent explanations, and destructive/error copy must remain readable against their actual surface. Do not soften text into pale gray for elegance.

**The Selection Outline Rule.** Selected appointments use the dedicated selection ring token, not the softer info token, so 2px rings remain visible on white surfaces and info-muted fills.

**The Destructive Action Rule.** Destructive is dark enough in light mode to work both as white-on-fill button background and as small error text on blush, lemon, or white surfaces. Dark-mode destructive surfaces may use the same translucent pink fill as destructive buttons.

## 3. Typography

**Display Font:** Poppins, with sans-serif fallback  
**Body Font:** Poppins, with sans-serif fallback  
**Serif Font:** Lora for rare editorial or patient-facing emphasis only  
**Label/Mono Font:** Fira Code for logs, technical identifiers, imported file traces, and debugging surfaces

**Character:** Poppins gives the theme a friendlier shape while staying legible in product density. The type system should rely on weight, spacing, and proximity rather than decorative display typography.

### Hierarchy

- **Display** (700, 2.25rem, 1.1): Landing or dashboard-level headings only. Product screens should use this sparingly.
- **Headline** (600, 1.5rem, 1.2): Page and major panel titles.
- **Title** (600, 1rem, 1): Card titles, table region titles, modal titles, and compact section headers.
- **Body** (400, 0.875rem, 1.5): Default copy, field help, descriptions, and patient-facing instructions. Prose should stay within 65-75ch.
- **Label** (500, 0.875rem, 1.25): Buttons, field labels, tabs, compact controls, and navigation items.
- **Mono** (400, 0.875rem, 1.5): GDT logs, technical traces, rule diagnostics, IDs, and imported file details.

### Named Rules

**The Product Type Rule.** Do not introduce the serif into labels, buttons, tables, forms, or calendar cells. Product UI uses the sans family well.

**The No Fluid UI Type Rule.** Use fixed rem sizes for product UI. Fluid clamp scales belong to marketing surfaces, not dense scheduling tools.

## 4. Elevation

Praxisplaner uses blocky theme shadows sparingly. Depth comes from borders, tonal layers, sticky headers, and the preset's sharp offset shadows for overlays or state feedback. Resting dense work surfaces should not pair every border with a heavy decorative shadow.

### Shadow Vocabulary

- **Block Lift** (`3px 3px 0px 0px hsl(325.78 58.18% 56.86% / 1)`): The theme's primary tactile shadow for buttons, popovers, and selected surfaces.
- **Panel Lift** (`3px 3px 0px 0px hsl(325.78 58.18% 56.86% / 1), 3px 2px 4px -1px hsl(325.78 58.18% 56.86% / 1)`): Menus, popovers, dialogs, and surfaces that must sit over the task.
- **Strong Overlay Lift** (`3px 3px 0px 0px hsl(325.78 58.18% 56.86% / 1), 3px 8px 10px -1px hsl(325.78 58.18% 56.86% / 1)`): Rare overlay or drag state only.

### Named Rules

**The Block Shadow Rule.** The offset shadow is a brand accent, not a default card treatment. Use it where tactile affordance matters.

**The No Ghost Card Rule.** Never combine a 1px border with a wide decorative drop shadow. Pick border structure or compact lift, not both.

## 5. Components

### Buttons

- **Shape:** Compact moderate-radius rectangles. Keep buttons crisp, not pill-like.
- **Primary:** Signal Rose background with white foreground, 36px height, 16px horizontal padding, medium label weight.
- **Hover / Focus:** Hover may reduce opacity or shift the background token slightly. Focus must use the visible 3px ring treatment.
- **Secondary / Ghost / Outline:** Secondary uses Control Gray. Outline uses a border and background surface. Ghost appears only where the surrounding structure already makes the action clear.

### Chips

- **Style:** Badges use the moderate preset radius, compact x-padding, and a text-xs label. Primary badges are for strong status, secondary badges for supporting metadata.
- **State:** Selected or active chips may use the signal accent once it exists. Do not make every metadata tag colorful.

### Cards / Containers

- **Corner Style:** Current containers use the moderate preset radius. Do not push cards into pill-like or over-rounded shapes.
- **Background:** Cards use Lemon Surface on Blush Field, with powder panels for nested context.
- **Shadow Strategy:** Use the Block Shadow Rule. Cards at rest should rely on border and spacing before shadow.
- **Border:** 1px Rose Rule for structure.
- **Internal Padding:** 24px for full cards, 12-16px for dense operational modules.

### Inputs / Fields

- **Style:** 36px height, moderate corners, 1px input border, transparent or background surface, 12px horizontal padding.
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
- **Do** keep corners compact and intentional, never bubbly by default.
- **Do** preserve strong keyboard focus and WCAG 2.2 AA contrast across booking and staff workflows.
- **Do** use borders, tonal panels, and sticky structure to explain scheduling logic before adding visual effects.

### Don't:

- **Don't** ship generic monochrome SaaS minimalism that feels like a default Vercel template with no healthcare-specific judgment.
- **Don't** use over-rounded cards, pill-heavy layouts, decorative gradients, or soft ghost-card shadows.
- **Don't** add playful medical illustrations or marketing-page composition inside task surfaces.
- **Don't** make patients feel they are operating internal practice software.
- **Don't** use side-stripe borders greater than 1px as accent decoration.
- **Don't** use gradient text, glassmorphism as default, or decorative page-load choreography.
