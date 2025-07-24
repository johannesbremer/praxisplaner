import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

// Get appointments for a specific date range and practice
export const getAppointments = query({
  args: {
    endDate: v.string(), // ISO date string
    practiceId: v.id("practices"),
    startDate: v.string(), // ISO date string
  },
  handler: async (ctx, args) => {
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_practiceId_startTime", (q) =>
        q.eq("practiceId", args.practiceId).gte("startTime", args.startDate),
      )
      .filter((q) => q.lte(q.field("startTime"), args.endDate))
      .collect();

    return appointments;
  },
});

// Get appointments for a specific practitioner and date range
export const getAppointmentsForPractitioner = query({
  args: {
    endDate: v.string(),
    practitionerId: v.id("practitioners"),
    startDate: v.string(),
  },
  handler: async (ctx, args) => {
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_practitionerId_startTime", (q) =>
        q
          .eq("practitionerId", args.practitionerId)
          .gte("startTime", args.startDate),
      )
      .filter((q) => q.lte(q.field("startTime"), args.endDate))
      .collect();

    return appointments;
  },
});

// Create a new appointment
export const createAppointment = mutation({
  args: {
    appointmentType: v.string(),
    description: v.optional(v.string()),
    duration: v.number(),
    endTime: v.string(),
    locationId: v.optional(v.id("locations")),
    patientId: v.optional(v.id("patients")),
    practiceId: v.id("practices"),
    practitionerId: v.id("practitioners"),
    startTime: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const appointmentId = await ctx.db.insert("appointments", {
      ...args,
      createdAt: now,
      status: "SCHEDULED",
      updatedAt: now,
    });

    return appointmentId;
  },
});

// Update an existing appointment
export const updateAppointment = mutation({
  args: {
    appointmentId: v.id("appointments"),
    appointmentType: v.optional(v.string()),
    description: v.optional(v.string()),
    duration: v.optional(v.number()),
    endTime: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
    patientId: v.optional(v.id("patients")),
    startTime: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("SCHEDULED"),
        v.literal("CONFIRMED"),
        v.literal("CANCELLED"),
        v.literal("COMPLETED"),
      ),
    ),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { appointmentId, ...updates } = args;

    await ctx.db.patch(appointmentId, {
      ...updates,
      updatedAt: Date.now(),
    });

    return null;
  },
});

// Delete an appointment
export const deleteAppointment = mutation({
  args: {
    appointmentId: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.appointmentId);
    return null;
  },
});
