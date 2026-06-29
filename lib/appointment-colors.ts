import type { AppointmentColor } from "../convex/schema";

export const DEFAULT_APPOINTMENT_COLOR: AppointmentColor = "blue";

export const APPOINTMENT_COLOR_VALUES = [
  "blue",
  "teal",
  "green",
  "lime",
  "yellow",
  "orange",
  "red",
  "rose",
  "fuchsia",
  "violet",
  "indigo",
  "slate",
] as const satisfies readonly AppointmentColor[];

export const APPOINTMENT_COLOR_OPTIONS = [
  {
    background: "#1d4ed8",
    border: "#1e40af",
    foreground: "#ffffff",
    label: "Blau",
    value: "blue",
  },
  {
    background: "#0f766e",
    border: "#115e59",
    foreground: "#ffffff",
    label: "Petrol",
    value: "teal",
  },
  {
    background: "#047857",
    border: "#065f46",
    foreground: "#ffffff",
    label: "Grün",
    value: "green",
  },
  {
    background: "#65a30d",
    border: "#4d7c0f",
    foreground: "#111827",
    label: "Limette",
    value: "lime",
  },
  {
    background: "#ca8a04",
    border: "#a16207",
    foreground: "#111827",
    label: "Gelb",
    value: "yellow",
  },
  {
    background: "#c2410c",
    border: "#9a3412",
    foreground: "#ffffff",
    label: "Orange",
    value: "orange",
  },
  {
    background: "#b91c1c",
    border: "#991b1b",
    foreground: "#ffffff",
    label: "Rot",
    value: "red",
  },
  {
    background: "#be123c",
    border: "#9f1239",
    foreground: "#ffffff",
    label: "Rosa",
    value: "rose",
  },
  {
    background: "#a21caf",
    border: "#86198f",
    foreground: "#ffffff",
    label: "Fuchsia",
    value: "fuchsia",
  },
  {
    background: "#7e22ce",
    border: "#6b21a8",
    foreground: "#ffffff",
    label: "Violett",
    value: "violet",
  },
  {
    background: "#4338ca",
    border: "#3730a3",
    foreground: "#ffffff",
    label: "Indigo",
    value: "indigo",
  },
  {
    background: "#475569",
    border: "#334155",
    foreground: "#ffffff",
    label: "Schiefer",
    value: "slate",
  },
] as const satisfies readonly {
  background: string;
  border: string;
  foreground: string;
  label: string;
  value: AppointmentColor;
}[];

export const APPOINTMENT_COLOR_BY_VALUE = Object.fromEntries(
  APPOINTMENT_COLOR_OPTIONS.map((option) => [option.value, option]),
) as Record<AppointmentColor, (typeof APPOINTMENT_COLOR_OPTIONS)[number]>;
