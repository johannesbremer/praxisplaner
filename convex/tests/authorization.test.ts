import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";

import { api, internal } from "../_generated/api";
import { insertSelfLineageEntity, requireLineageKey } from "../lineage";
import schema from "../schema";
import { modules } from "./test.setup";

async function createPracticeForUser(
  t: ReturnType<typeof createTestContext>,
  authId: string,
  email: string,
) {
  await createUser(t, authId, email);
  const authed = t.withIdentity({ email, subject: authId });
  const practiceId = await authed.mutation(api.practices.createPractice, {
    name: `${authId} practice`,
  });
  const practice = await t.run(
    async (ctx) => await ctx.db.get("practices", practiceId),
  );
  if (!practice?.currentActiveRuleSetId) {
    throw new Error("Expected created practice to have an active rule set.");
  }
  const user = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", authId))
      .first();
  });
  if (!user) {
    throw new Error("Expected synced test user to exist.");
  }
  return {
    authed,
    practiceId,
    ruleSetId: practice.currentActiveRuleSetId,
    userId: user._id,
  };
}

async function createPublicBookingSchedulingFixture(
  t: ReturnType<typeof createTestContext>,
  args: {
    practiceId: Id<"practices">;
    ruleSetId: Id<"ruleSets">;
  },
) {
  return await t.run(async (ctx) => {
    const practitionerId = await insertSelfLineageEntity(
      ctx.db,
      "practitioners",
      {
        name: "Dr. Public",
        practiceId: args.practiceId,
        ruleSetId: args.ruleSetId,
      },
    );
    const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
      name: "Public Office",
      practiceId: args.practiceId,
      ruleSetId: args.ruleSetId,
    });
    const appointmentTypeId = await insertSelfLineageEntity(
      ctx.db,
      "appointmentTypes",
      {
        allowedPractitionerLineageKeys: [practitionerId],
        createdAt: BigInt(Date.now()),
        duration: 30,
        lastModified: BigInt(Date.now()),
        name: "Public Booking",
        practiceId: args.practiceId,
        ruleSetId: args.ruleSetId,
      },
    );
    const practitioner = await ctx.db.get("practitioners", practitionerId);
    const location = await ctx.db.get("locations", locationId);
    if (!practitioner || !location) {
      throw new Error("Expected scheduling fixture entities to exist.");
    }
    await insertSelfLineageEntity(ctx.db, "baseSchedules", {
      breakTimes: [],
      dayOfWeek: 1,
      endTime: "10:00",
      locationLineageKey: requireLineageKey({
        entityId: location._id,
        entityType: "location",
        lineageKey: location.lineageKey,
        ruleSetId: args.ruleSetId,
      }),
      practiceId: args.practiceId,
      practitionerLineageKey: requireLineageKey({
        entityId: practitioner._id,
        entityType: "practitioner",
        lineageKey: practitioner.lineageKey,
        ruleSetId: args.ruleSetId,
      }),
      ruleSetId: args.ruleSetId,
      startTime: "09:00",
    });
    return { appointmentTypeId, locationId };
  });
}

function createTestContext() {
  return convexTest(schema, modules);
}

async function createUser(
  t: ReturnType<typeof createTestContext>,
  authId: string,
  email: string,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      authId,
      createdAt: BigInt(Date.now()),
      email,
    });
  });
}

async function setMembershipRole(
  t: ReturnType<typeof createTestContext>,
  args: {
    practiceId: Id<"practices">;
    role: "admin" | "owner" | "staff";
    userId: Id<"users">;
  },
) {
  await t.run(async (ctx) => {
    const membership = await ctx.db
      .query("practiceMembers")
      .withIndex("by_practiceId_userId", (q) =>
        q.eq("practiceId", args.practiceId).eq("userId", args.userId),
      )
      .first();
    if (!membership) {
      await ctx.db.insert("practiceMembers", {
        createdAt: BigInt(Date.now()),
        practiceId: args.practiceId,
        role: args.role,
        userId: args.userId,
      });
      return;
    }
    await ctx.db.patch("practiceMembers", membership._id, { role: args.role });
  });
}

describe("Convex query authorization", () => {
  test("queries do not use an unauthenticated local fallback identity", async () => {
    const t = createTestContext();

    await expect(t.query(api.practices.getAllPractices, {})).rejects.toThrow(
      "Authentication required",
    );
  });

  test("query access rejects authenticated identities without provisioned users", async () => {
    const t = createTestContext();
    const authed = t.withIdentity({
      email: "unprovisioned-authz@example.com",
      subject: "workos_unprovisioned_authz",
    });

    await expect(
      authed.query(api.practices.getAllPractices, {}),
    ).rejects.toThrow("Authenticated user is not provisioned");
  });

  test("booking practice discovery requires a provisioned app user", async () => {
    const t = createTestContext();
    const authed = t.withIdentity({
      email: "unprovisioned-booking-practices@example.com",
      subject: "workos_unprovisioned_booking_practices",
    });

    await expect(
      authed.query(api.practices.getBookingPractices, {}),
    ).rejects.toThrow("Authenticated user is not provisioned");
  });

  test("trusted current user profile insertion creates the app user", async () => {
    const t = createTestContext();
    const authId = "workos_provision_current_user";

    const userId = await t.mutation(
      internal.users.insertProvisionedUserFromTrustedProfile,
      {
        email: "provision-current-user@example.com",
        firstName: "Provision",
        lastName: "User",
        workOSUserId: authId,
      },
    );
    const user = await t.run(async (ctx) => await ctx.db.get("users", userId));

    expect(user).toMatchObject({
      authId,
      email: "provision-current-user@example.com",
      firstName: "Provision",
      lastName: "User",
    });
  });

  test("current user provisioning rejects a mismatched WorkOS user id", async () => {
    const t = createTestContext();
    const authed = t.withIdentity({
      subject: "workos_provision_subject",
    });

    await expect(
      authed.action(api.users.provisionCurrentUserFromAuthIdentity, {
        workOSUserId: "workos_provision_other",
      }),
    ).rejects.toThrow("Authenticated identity does not match WorkOS user");
  });

  test("current user provisioning returns existing user without WorkOS lookup", async () => {
    const t = createTestContext();
    const authId = "workos_existing_provisioned_user";
    const userId = await createUser(
      t,
      authId,
      "existing-provisioned-user@example.com",
    );
    const authed = t.withIdentity({
      subject: authId,
    });

    await expect(
      authed.action(api.users.provisionCurrentUserFromAuthIdentity, {
        workOSUserId: authId,
      }),
    ).resolves.toBe(userId);
  });

  test("booking practice discovery works after current user provisioning", async () => {
    const t = createTestContext();
    const authId = "workos_provisioned_booking_practices";
    const authed = t.withIdentity({
      subject: authId,
    });

    await t.mutation(internal.users.insertProvisionedUserFromTrustedProfile, {
      email: "provisioned-booking-practices@example.com",
      workOSUserId: authId,
    });

    await expect(
      authed.query(api.practices.getBookingPractices, {}),
    ).resolves.toEqual([]);
  });

  test("query access rejects duplicate app users for one auth identity", async () => {
    const t = createTestContext();
    const authId = "workos_duplicate_query_user";
    await createUser(t, authId, "duplicate-query-1@example.com");
    await createUser(t, authId, "duplicate-query-2@example.com");
    const authed = t.withIdentity({
      email: "duplicate-query@example.com",
      subject: authId,
    });

    await expect(
      authed.query(api.practices.getAllPractices, {}),
    ).rejects.toThrow("Multiple app users exist for authenticated identity");
  });

  test("mutation access rejects duplicate app users for one auth identity", async () => {
    const t = createTestContext();
    const authId = "workos_duplicate_mutation_user";
    await createUser(t, authId, "duplicate-mutation-1@example.com");
    await createUser(t, authId, "duplicate-mutation-2@example.com");
    const authed = t.withIdentity({
      email: "duplicate-mutation@example.com",
      subject: authId,
    });

    await expect(
      authed.mutation(api.practices.createPractice, {
        name: "Duplicate Mutation Practice",
      }),
    ).rejects.toThrow("Multiple app users exist for authenticated identity");
  });

  test("authenticated users cannot self-enroll through default practice bootstrap", async () => {
    const t = createTestContext();
    const authId = "workos_authz_bootstrap_denied";
    const email = "authz-bootstrap-denied@example.com";
    await createPracticeForUser(
      t,
      "workos_authz_existing_owner",
      "owner@example.com",
    );
    const authed = t.withIdentity({ email, subject: authId });

    await expect(
      authed.mutation(api.practices.initializeDefaultPractice, {}),
    ).rejects.toThrow("only available in bypass mode");
  });

  test("staff can read practice data but not manager-only practice data", async () => {
    const t = createTestContext();
    const authId = "workos_authz_staff";
    const email = "authz-staff@example.com";
    const { authed, practiceId, userId } = await createPracticeForUser(
      t,
      authId,
      email,
    );
    await setMembershipRole(t, { practiceId, role: "staff", userId });

    await expect(
      authed.query(api.practices.getPractice, { practiceId }),
    ).resolves.toMatchObject({ _id: practiceId });
    await expect(
      authed.query(api.practices.getPracticeMembers, { practiceId }),
    ).rejects.toThrow("Role staff is insufficient");
    await expect(
      authed.query(api.ruleSets.getActiveRuleSet, { practiceId }),
    ).resolves.toMatchObject({ _id: expect.any(String) });
  });

  test("staff cannot perform manager-only rule-set lifecycle mutations", async () => {
    const t = createTestContext();
    const authId = "workos_authz_staff_rule_mutation";
    const email = "authz-staff-rule-mutation@example.com";
    const { authed, practiceId, userId } = await createPracticeForUser(
      t,
      authId,
      email,
    );
    await setMembershipRole(t, { practiceId, role: "staff", userId });

    await expect(
      authed.mutation(api.ruleSets.discardUnsavedRuleSet, { practiceId }),
    ).rejects.toThrow("Role staff is insufficient");
  });

  test("authenticated non-members can only read projected active booking reference entities", async () => {
    const t = createTestContext();
    const patientUserId = await createUser(
      t,
      "workos_authz_booking_reference_patient",
      "authz-booking-reference-patient@example.com",
    );
    const practice = await createPracticeForUser(
      t,
      "workos_authz_booking_reference_owner",
      "authz-booking-reference-owner@example.com",
    );

    await t.run(async (ctx) => {
      await insertSelfLineageEntity(ctx.db, "appointmentTypes", {
        allowedPractitionerLineageKeys: [],
        createdAt: BigInt(Date.now()),
        duration: 20,
        lastModified: BigInt(Date.now()),
        name: "Booking reference",
        practiceId: practice.practiceId,
        ruleSetId: practice.ruleSetId,
      });
      await insertSelfLineageEntity(ctx.db, "locations", {
        name: "Booking location",
        practiceId: practice.practiceId,
        ruleSetId: practice.ruleSetId,
      });
      await insertSelfLineageEntity(ctx.db, "practitioners", {
        name: "Dr. Booking",
        practiceId: practice.practiceId,
        ruleSetId: practice.ruleSetId,
      });
    });

    const patient = t.withIdentity({
      email: "authz-booking-reference-patient@example.com",
      subject: "workos_authz_booking_reference_patient",
    });
    expect(patientUserId).toBeDefined();

    await expect(
      patient.query(api.entities.getAppointmentTypes, {
        ruleSetId: practice.ruleSetId,
      }),
    ).rejects.toThrow("No access to this practice");
    await expect(
      patient.query(api.entities.getLocations, {
        ruleSetId: practice.ruleSetId,
      }),
    ).rejects.toThrow("No access to this practice");
    await expect(
      patient.query(api.entities.getPractitioners, {
        ruleSetId: practice.ruleSetId,
      }),
    ).rejects.toThrow("No access to this practice");

    const appointmentTypes = await patient.query(
      api.entities.getBookingAppointmentTypes,
      {
        ruleSetId: practice.ruleSetId,
      },
    );
    const locations = await patient.query(api.entities.getBookingLocations, {
      ruleSetId: practice.ruleSetId,
    });
    const practitioners = await patient.query(
      api.entities.getBookingPractitioners,
      {
        ruleSetId: practice.ruleSetId,
      },
    );

    expect(appointmentTypes).toHaveLength(1);
    expect(locations).toHaveLength(1);
    expect(practitioners).toHaveLength(1);

    const [appointmentType] = appointmentTypes;
    const [location] = locations;
    const [practitioner] = practitioners;
    if (!appointmentType || !location || !practitioner) {
      throw new Error("Expected booking reference projections.");
    }

    expect(appointmentType).toEqual({
      _id: appointmentType._id,
      duration: 20,
      lineageKey: appointmentType.lineageKey,
      name: "Booking reference",
    });
    expect(appointmentType).not.toHaveProperty(
      "allowedPractitionerLineageKeys",
    );
    expect(appointmentType).not.toHaveProperty("followUpPlan");
    expect(appointmentType).not.toHaveProperty("practiceId");
    expect(appointmentType).not.toHaveProperty("ruleSetId");

    expect(location).toEqual({
      _id: location._id,
      lineageKey: location.lineageKey,
      name: "Booking location",
    });
    expect(location).not.toHaveProperty("practiceId");
    expect(location).not.toHaveProperty("ruleSetId");
    expect(location).not.toHaveProperty("parentId");

    expect(practitioner).toEqual({
      _id: practitioner._id,
      lineageKey: practitioner.lineageKey,
      name: "Dr. Booking",
    });
    expect(practitioner).not.toHaveProperty("practiceId");
    expect(practitioner).not.toHaveProperty("ruleSetId");
    expect(practitioner).not.toHaveProperty("parentId");
  });

  test("authenticated non-members cannot read inactive foreign rule-set entities", async () => {
    const t = createTestContext();
    const first = await createPracticeForUser(
      t,
      "workos_authz_entity_reader",
      "authz-entity-reader@example.com",
    );
    const second = await createPracticeForUser(
      t,
      "workos_authz_entity_foreign_owner",
      "authz-entity-foreign-owner@example.com",
    );

    const inactiveRuleSetId = await t.run(async (ctx) => {
      const ruleSetId = await ctx.db.insert("ruleSets", {
        createdAt: Date.now(),
        description: "Inactive Foreign Rule Set",
        draftRevision: 0,
        practiceId: second.practiceId,
        saved: false,
        version: 2,
      });
      await insertSelfLineageEntity(ctx.db, "practitioners", {
        name: "Dr. Foreign Entity",
        practiceId: second.practiceId,
        ruleSetId,
      });
      return ruleSetId;
    });

    await expect(
      first.authed.query(api.entities.getPractitioners, {
        ruleSetId: inactiveRuleSetId,
      }),
    ).rejects.toThrow("No access to this practice");
  });

  test("admin can read manager-only practice data", async () => {
    const t = createTestContext();
    const authId = "workos_authz_admin";
    const email = "authz-admin@example.com";
    const { authed, practiceId, userId } = await createPracticeForUser(
      t,
      authId,
      email,
    );
    await setMembershipRole(t, { practiceId, role: "admin", userId });

    await expect(
      authed.query(api.practices.getPracticeMembers, { practiceId }),
    ).resolves.toHaveLength(1);
  });

  test("admin can add another practice admin", async () => {
    const t = createTestContext();
    const adminAuthId = "workos_authz_admin_adds_admin";
    const adminEmail = "authz-admin-adds-admin@example.com";
    const { authed, practiceId, userId } = await createPracticeForUser(
      t,
      adminAuthId,
      adminEmail,
    );
    await setMembershipRole(t, { practiceId, role: "admin", userId });
    const targetUserId = await createUser(
      t,
      "workos_authz_admin_target_admin",
      "authz-admin-target-admin@example.com",
    );

    const membershipId = await authed.mutation(
      api.practices.upsertPracticeMember,
      {
        practiceId,
        role: "admin",
        userId: targetUserId,
      },
    );
    const membership = await t.run(
      async (ctx) => await ctx.db.get("practiceMembers", membershipId),
    );

    expect(membership).toMatchObject({
      practiceId,
      role: "admin",
      userId: targetUserId,
    });
  });

  test("admin cannot promote a practice member to owner", async () => {
    const t = createTestContext();
    const adminAuthId = "workos_authz_admin_promotes_owner";
    const adminEmail = "authz-admin-promotes-owner@example.com";
    const { authed, practiceId, userId } = await createPracticeForUser(
      t,
      adminAuthId,
      adminEmail,
    );
    await setMembershipRole(t, { practiceId, role: "admin", userId });
    const targetUserId = await createUser(
      t,
      "workos_authz_owner_promotion_target",
      "authz-owner-promotion-target@example.com",
    );

    await expect(
      authed.mutation(api.practices.upsertPracticeMember, {
        practiceId,
        role: "owner",
        userId: targetUserId,
      }),
    ).rejects.toThrow("Role admin is insufficient");
  });

  test("admin cannot demote an existing practice owner", async () => {
    const t = createTestContext();
    const adminAuthId = "workos_authz_admin_demotes_owner";
    const adminEmail = "authz-admin-demotes-owner@example.com";
    const { authed, practiceId, userId } = await createPracticeForUser(
      t,
      adminAuthId,
      adminEmail,
    );
    await setMembershipRole(t, { practiceId, role: "admin", userId });
    const targetUserId = await createUser(
      t,
      "workos_authz_owner_demotion_target",
      "authz-owner-demotion-target@example.com",
    );
    await setMembershipRole(t, {
      practiceId,
      role: "owner",
      userId: targetUserId,
    });

    await expect(
      authed.mutation(api.practices.upsertPracticeMember, {
        practiceId,
        role: "admin",
        userId: targetUserId,
      }),
    ).rejects.toThrow("Role admin is insufficient");
  });

  test("owner can promote a practice member to owner", async () => {
    const t = createTestContext();
    const ownerAuthId = "workos_authz_owner_promotes_owner";
    const ownerEmail = "authz-owner-promotes-owner@example.com";
    const { authed, practiceId } = await createPracticeForUser(
      t,
      ownerAuthId,
      ownerEmail,
    );
    const targetUserId = await createUser(
      t,
      "workos_authz_owner_target_owner",
      "authz-owner-target-owner@example.com",
    );

    const membershipId = await authed.mutation(
      api.practices.upsertPracticeMember,
      {
        practiceId,
        role: "owner",
        userId: targetUserId,
      },
    );
    const membership = await t.run(
      async (ctx) => await ctx.db.get("practiceMembers", membershipId),
    );

    expect(membership).toMatchObject({
      practiceId,
      role: "owner",
      userId: targetUserId,
    });
  });

  test("practice-scoped user display returns booking personal data from the authorized practice only", async () => {
    const t = createTestContext();
    const first = await createPracticeForUser(
      t,
      "workos_authz_user_display_first",
      "authz-user-display-first@example.com",
    );
    const second = await createPracticeForUser(
      t,
      "workos_authz_user_display_second",
      "authz-user-display-second@example.com",
    );
    const targetUserId = await createUser(
      t,
      "workos_authz_user_display_target",
      "authz-user-display-target@example.com",
    );
    await setMembershipRole(t, {
      practiceId: first.practiceId,
      role: "staff",
      userId: targetUserId,
    });
    await setMembershipRole(t, {
      practiceId: second.practiceId,
      role: "staff",
      userId: targetUserId,
    });
    await t.run(async (ctx) => {
      const baseRow = {
        city: "Dissen",
        dateOfBirth: "1980-01-01",
        email: "target@example.com",
        gender: "diverse" as const,
        phoneNumber: "+491700000002",
        postalCode: "49201",
        street: "Westendarpstrasse 1",
        userId: targetUserId,
      };
      await ctx.db.insert("bookingPersonalDataSteps", {
        ...baseRow,
        createdAt: 1n,
        firstName: "Same",
        lastModified: 1n,
        lastName: "Practice",
        practiceId: first.practiceId,
        ruleSetId: first.ruleSetId,
      });
      await ctx.db.insert("bookingPersonalDataSteps", {
        ...baseRow,
        createdAt: 2n,
        firstName: "Foreign",
        lastModified: 2n,
        lastName: "Practice",
        practiceId: second.practiceId,
        ruleSetId: second.ruleSetId,
      });
    });

    await expect(
      first.authed.query(api.users.getById, {
        id: targetUserId,
        practiceId: first.practiceId,
      }),
    ).resolves.toMatchObject({
      bookingPersonalData: {
        firstName: "Same",
        lastName: "Practice",
      },
    });
  });

  test("patient booking scope rejects mismatched practice and rule set", async () => {
    const t = createTestContext();
    const first = await createPracticeForUser(
      t,
      "workos_authz_first_owner",
      "authz-first-owner@example.com",
    );
    const second = await createPracticeForUser(
      t,
      "workos_authz_second_owner",
      "authz-second-owner@example.com",
    );
    const patientAuthId = "workos_authz_patient";
    const patientEmail = "authz-patient@example.com";
    await createUser(t, patientAuthId, patientEmail);
    const patient = t.withIdentity({
      email: patientEmail,
      subject: patientAuthId,
    });

    await expect(
      patient.query(api.scheduling.getSlotsForDay, {
        date: "2026-01-05",
        practiceId: first.practiceId,
        ruleSetId: second.ruleSetId,
        simulatedContext: {
          patient: { isNew: true },
        },
      }),
    ).rejects.toThrow("Rule set does not belong to this practice");
  });

  test("patient booking scope cannot request simulation scheduling occupancy", async () => {
    const t = createTestContext();
    const practice = await createPracticeForUser(
      t,
      "workos_authz_simulation_scope_owner",
      "authz-simulation-scope-owner@example.com",
    );
    const patientAuthId = "workos_authz_simulation_scope_patient";
    const patientEmail = "authz-simulation-scope-patient@example.com";
    await createUser(t, patientAuthId, patientEmail);

    const schedulingRefs = await t.run(async (ctx) => {
      const now = BigInt(Date.now());
      const locationId = await insertSelfLineageEntity(ctx.db, "locations", {
        name: "Simulation Scope Location",
        practiceId: practice.practiceId,
        ruleSetId: practice.ruleSetId,
      });
      const practitionerId = await insertSelfLineageEntity(
        ctx.db,
        "practitioners",
        {
          name: "Dr. Simulation Scope",
          practiceId: practice.practiceId,
          ruleSetId: practice.ruleSetId,
        },
      );
      const appointmentTypeId = await insertSelfLineageEntity(
        ctx.db,
        "appointmentTypes",
        {
          allowedPractitionerLineageKeys: [practitionerId],
          createdAt: now,
          duration: 5,
          followUpPlan: [],
          lastModified: now,
          name: "Simulation Scope Checkup",
          practiceId: practice.practiceId,
          ruleSetId: practice.ruleSetId,
        },
      );
      await insertSelfLineageEntity(ctx.db, "baseSchedules", {
        dayOfWeek: 1,
        endTime: "09:05",
        locationLineageKey: locationId,
        practiceId: practice.practiceId,
        practitionerLineageKey: practitionerId,
        ruleSetId: practice.ruleSetId,
        startTime: "09:00",
      });
      await ctx.db.insert("blockedSlots", {
        createdAt: now,
        end: "2026-06-22T09:05:00+02:00[Europe/Berlin]",
        isSimulation: true,
        lastModified: now,
        locationLineageKey: locationId,
        occupancyScope: {
          kind: "practitioner",
          practitionerLineageKey: practitionerId,
        },
        practiceId: practice.practiceId,
        start: "2026-06-22T09:00:00+02:00[Europe/Berlin]",
        title: "Draft-only block",
      });

      return { appointmentTypeId, locationId, practitionerId };
    });

    const queryArgs = {
      date: "2026-06-22",
      enforceFutureOnly: false,
      practiceId: practice.practiceId,
      ruleSetId: practice.ruleSetId,
      scope: "simulation" as const,
      simulatedContext: {
        appointmentTypeLineageKey: schedulingRefs.appointmentTypeId,
        clientType: "MFA",
        locationLineageKey: schedulingRefs.locationId,
        patient: { isNew: true },
      },
    };
    const patient = t.withIdentity({
      email: patientEmail,
      subject: patientAuthId,
    });

    await expect(
      practice.authed.query(api.scheduling.getSlotsForDay, queryArgs),
    ).resolves.toMatchObject({
      slots: [
        {
          practitionerLineageKey: schedulingRefs.practitionerId,
          status: "BLOCKED",
        },
      ],
    });
    await expect(
      patient.query(api.scheduling.getSlotsForDay, queryArgs),
    ).resolves.toMatchObject({
      slots: [
        {
          practitionerLineageKey: schedulingRefs.practitionerId,
          status: "AVAILABLE",
        },
      ],
    });
    const nextSlotQueryArgs = {
      date: queryArgs.date,
      practiceId: queryArgs.practiceId,
      ruleSetId: queryArgs.ruleSetId,
      scope: queryArgs.scope,
      simulatedContext: queryArgs.simulatedContext,
    };
    await expect(
      practice.authed.query(
        api.scheduling.getNextAvailableSlot,
        nextSlotQueryArgs,
      ),
    ).resolves.toMatchObject({
      startTime: "2026-06-29T09:00:00+02:00[Europe/Berlin]",
      status: "AVAILABLE",
    });
    await expect(
      patient.query(api.scheduling.getNextAvailableSlot, nextSlotQueryArgs),
    ).resolves.toMatchObject({
      practitionerLineageKey: schedulingRefs.practitionerId,
      startTime: "2026-06-22T09:00:00+02:00[Europe/Berlin]",
      status: "AVAILABLE",
    });
  });

  test("patient booking scope does not receive scheduling diagnostics", async () => {
    const t = createTestContext();
    const owner = await createPracticeForUser(
      t,
      "workos_authz_public_booking_owner",
      "authz-public-booking-owner@example.com",
    );
    const fixture = await createPublicBookingSchedulingFixture(t, owner);
    const patientAuthId = "workos_authz_public_booking_patient";
    const patientEmail = "authz-public-booking-patient@example.com";
    await createUser(t, patientAuthId, patientEmail);
    const patient = t.withIdentity({
      email: patientEmail,
      subject: patientAuthId,
    });

    const result = await patient.query(api.scheduling.getSlotsForDay, {
      date: "2026-01-05",
      enforceFutureOnly: false,
      practiceId: owner.practiceId,
      ruleSetId: owner.ruleSetId,
      simulatedContext: {
        appointmentTypeLineageKey: fixture.appointmentTypeId,
        clientType: "MFA",
        locationLineageKey: fixture.locationId,
        patient: { isNew: true },
      },
    });

    expect(result.slots.length).toBeGreaterThan(0);
    expect("log" in result).toBe(false);
  });

  test("practice-scoped user display query does not expose unrelated users", async () => {
    const t = createTestContext();
    const { authed, practiceId } = await createPracticeForUser(
      t,
      "workos_authz_display_owner",
      "authz-display-owner@example.com",
    );
    const unrelatedUserId = await createUser(
      t,
      "workos_authz_unrelated",
      "authz-unrelated@example.com",
    );

    await expect(
      authed.query(api.users.getUsersByIds, {
        practiceId,
        userIds: [unrelatedUserId],
      }),
    ).resolves.toEqual({});
  });
});
