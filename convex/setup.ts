import { v } from "convex/values";

import { mutation } from "./_generated/server";

// Setup script to create demo data for calendar
export const setupDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    // Create a practice
    const practiceId = await ctx.db.insert("practices", {
      name: "Demo Praxis",
    });

    // Create practitioners
    const practitioner1Id = await ctx.db.insert("practitioners", {
      name: "Dr. Müller",
      practiceId,
    });

    const practitioner2Id = await ctx.db.insert("practitioners", {
      name: "Dr. Schmidt",
      practiceId,
    });

    // Create base schedules for today (assuming Monday = 1)
    const today = new Date();
    const dayOfWeek = today.getDay(); // Get current day of week

    // Dr. Müller works 8:00-16:00 on weekdays
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      await ctx.db.insert("baseSchedules", {
        dayOfWeek,
        endTime: "16:00",
        practitionerId: practitioner1Id,
        startTime: "08:00",
      });
    }

    // Dr. Schmidt works 9:00-17:00 on weekdays  
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      await ctx.db.insert("baseSchedules", {
        dayOfWeek,
        endTime: "17:00",
        practitionerId: practitioner2Id,
        startTime: "09:00",
      });
    }

    // Create some demo appointments for today
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0); // 10:00 AM
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 30); // 10:30 AM

    await ctx.db.insert("appointments", {
      createdAt: BigInt(Date.now()),
      end: todayEnd.toISOString(),
      lastModified: BigInt(Date.now()),
      practitionerId: practitioner1Id,
      start: todayStart.toISOString(),
      title: "Demo Termin - Patient Mustermann",
    });

    const afternoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0); // 2:00 PM
    const afternoonEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 45); // 2:45 PM

    await ctx.db.insert("appointments", {
      createdAt: BigInt(Date.now()),
      end: afternoonEnd.toISOString(),
      lastModified: BigInt(Date.now()),
      practitionerId: practitioner2Id,
      start: afternoon.toISOString(),
      title: "Demo Termin - Patient Meyer",
    });

    return {
      message: "Demo data created successfully",
      practiceId,
      practitioners: [practitioner1Id, practitioner2Id],
    };
  },
  returns: v.object({
    message: v.string(),
    practiceId: v.id("practices"),
    practitioners: v.array(v.id("practitioners")),
  }),
});

// Clean up demo data
export const cleanupDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    // Delete all test data
    const practices = await ctx.db.query("practices").collect();
    for (const practice of practices) {
      await ctx.db.delete(practice._id);
    }

    const practitioners = await ctx.db.query("practitioners").collect();
    for (const practitioner of practitioners) {
      await ctx.db.delete(practitioner._id);
    }

    const schedules = await ctx.db.query("baseSchedules").collect();
    for (const schedule of schedules) {
      await ctx.db.delete(schedule._id);
    }

    const appointments = await ctx.db.query("appointments").collect();
    for (const appointment of appointments) {
      await ctx.db.delete(appointment._id);
    }

    return { message: "Demo data cleaned up successfully" };
  },
  returns: v.object({
    message: v.string(),
  }),
});