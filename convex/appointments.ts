import { v } from "convex/values";

import { mutation, query } from "./_generated/server";

// Query to get all appointments
export const getAppointments = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("appointments").order("asc").collect();
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("appointments"),
      appointmentType: v.optional(v.string()),
      createdAt: v.int64(),
      end: v.string(),
      lastModified: v.int64(),
      locationId: v.optional(v.id("locations")),
      notes: v.optional(v.string()),
      patientId: v.optional(v.id("patients")),
      practitionerId: v.optional(v.id("practitioners")),
      start: v.string(),
      title: v.string(),
    }),
  ),
});

// Query to get appointments in a date range
export const getAppointmentsInRange = query({
  args: {
    end: v.string(),
    start: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_start")
      .filter((q) =>
        q.and(
          q.gte(q.field("start"), args.start),
          q.lte(q.field("start"), args.end),
        ),
      )
      .collect();
  },
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id("appointments"),
      appointmentType: v.optional(v.string()),
      createdAt: v.int64(),
      end: v.string(),
      lastModified: v.int64(),
      locationId: v.optional(v.id("locations")),
      notes: v.optional(v.string()),
      patientId: v.optional(v.id("patients")),
      practitionerId: v.optional(v.id("practitioners")),
      start: v.string(),
      title: v.string(),
    }),
  ),
});

// Mutation to create a new appointment
export const createAppointment = mutation({
  args: {
    appointmentType: v.optional(v.string()),
    end: v.string(),
    locationId: v.optional(v.id("locations")),
    notes: v.optional(v.string()),
    patientId: v.optional(v.id("patients")),
    practitionerId: v.optional(v.id("practitioners")),
    start: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const now = BigInt(Date.now());
    return await ctx.db.insert("appointments", {
      ...args,
      createdAt: now,
      lastModified: now,
    });
  },
  returns: v.id("appointments"),
});

// Mutation to update an existing appointment
export const updateAppointment = mutation({
  args: {
    appointmentType: v.optional(v.string()),
    end: v.optional(v.string()),
    id: v.id("appointments"),
    locationId: v.optional(v.id("locations")),
    notes: v.optional(v.string()),
    patientId: v.optional(v.id("patients")),
    practitionerId: v.optional(v.id("practitioners")),
    start: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updateData } = args;

    // Filter out undefined values

    const filteredUpdateData = Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      Object.entries(updateData).filter(([, value]) => value !== undefined),
    );

    await ctx.db.patch(id, {
      ...filteredUpdateData,
      lastModified: BigInt(Date.now()),
    });

    return null;
  },
  returns: v.null(),
});

// Mutation to delete an appointment
export const deleteAppointment = mutation({
  args: {
    id: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
  returns: v.null(),
});
