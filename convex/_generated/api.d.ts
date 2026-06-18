/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appointmentConflicts from "../appointmentConflicts.js";
import type * as appointmentCoverage from "../appointmentCoverage.js";
import type * as appointmentLeadTimes from "../appointmentLeadTimes.js";
import type * as appointmentOccupancy from "../appointmentOccupancy.js";
import type * as appointmentReferences from "../appointmentReferences.js";
import type * as appointmentSeries from "../appointmentSeries.js";
import type * as appointmentSimulation from "../appointmentSimulation.js";
import type * as appointments from "../appointments.js";
import type * as auth from "../auth.js";
import type * as authBypass from "../authBypass.js";
import type * as bookingIdentities from "../bookingIdentities.js";
import type * as bookingSessions from "../bookingSessions.js";
import type * as bookingValidators from "../bookingValidators.js";
import type * as copyOnWrite from "../copyOnWrite.js";
import type * as devAuth from "../devAuth.js";
import type * as devAuthData from "../devAuthData.js";
import type * as e164PhoneNumber from "../e164PhoneNumber.js";
import type * as entities from "../entities.js";
import type * as followUpPlans from "../followUpPlans.js";
import type * as gdt_processing from "../gdt/processing.js";
import type * as gdt_types from "../gdt/types.js";
import type * as gdt_validation from "../gdt/validation.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as legacyBookingMigrationShared from "../legacyBookingMigrationShared.js";
import type * as legacyUnmatchedFutureBookingHolds from "../legacyUnmatchedFutureBookingHolds.js";
import type * as lineage from "../lineage.js";
import type * as mfas from "../mfas.js";
import type * as migrationRehearsal from "../migrationRehearsal.js";
import type * as patientSearch from "../patientSearch.js";
import type * as patients from "../patients.js";
import type * as practiceAccess from "../practiceAccess.js";
import type * as practicePhoneNumbers from "../practicePhoneNumbers.js";
import type * as practiceSlugs from "../practiceSlugs.js";
import type * as practices from "../practices.js";
import type * as practitionerAssociations from "../practitionerAssociations.js";
import type * as publicHolidays from "../publicHolidays.js";
import type * as recursiveValidator from "../recursiveValidator.js";
import type * as ruleEngine from "../ruleEngine.js";
import type * as ruleSetDiff from "../ruleSetDiff.js";
import type * as ruleSetEntityDeletion from "../ruleSetEntityDeletion.js";
import type * as ruleSetLifecycle from "../ruleSetLifecycle.js";
import type * as ruleSetValidation from "../ruleSetValidation.js";
import type * as ruleSets from "../ruleSets.js";
import type * as scheduling from "../scheduling.js";
import type * as schedulingCore from "../schedulingCore.js";
import type * as scopedResources from "../scopedResources.js";
import type * as telefonki from "../telefonki.js";
import type * as temporaryPatients from "../temporaryPatients.js";
import type * as tests_test_utils from "../tests/test_utils.js";
import type * as typedDtos from "../typedDtos.js";
import type * as userIdentity from "../userIdentity.js";
import type * as users from "../users.js";
import type * as vacations from "../vacations.js";
import type * as validators from "../validators.js";
import type * as workosOrganizations from "../workosOrganizations.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appointmentConflicts: typeof appointmentConflicts;
  appointmentCoverage: typeof appointmentCoverage;
  appointmentLeadTimes: typeof appointmentLeadTimes;
  appointmentOccupancy: typeof appointmentOccupancy;
  appointmentReferences: typeof appointmentReferences;
  appointmentSeries: typeof appointmentSeries;
  appointmentSimulation: typeof appointmentSimulation;
  appointments: typeof appointments;
  auth: typeof auth;
  authBypass: typeof authBypass;
  bookingIdentities: typeof bookingIdentities;
  bookingSessions: typeof bookingSessions;
  bookingValidators: typeof bookingValidators;
  copyOnWrite: typeof copyOnWrite;
  devAuth: typeof devAuth;
  devAuthData: typeof devAuthData;
  e164PhoneNumber: typeof e164PhoneNumber;
  entities: typeof entities;
  followUpPlans: typeof followUpPlans;
  "gdt/processing": typeof gdt_processing;
  "gdt/types": typeof gdt_types;
  "gdt/validation": typeof gdt_validation;
  http: typeof http;
  identity: typeof identity;
  legacyBookingMigrationShared: typeof legacyBookingMigrationShared;
  legacyUnmatchedFutureBookingHolds: typeof legacyUnmatchedFutureBookingHolds;
  lineage: typeof lineage;
  mfas: typeof mfas;
  migrationRehearsal: typeof migrationRehearsal;
  patientSearch: typeof patientSearch;
  patients: typeof patients;
  practiceAccess: typeof practiceAccess;
  practicePhoneNumbers: typeof practicePhoneNumbers;
  practiceSlugs: typeof practiceSlugs;
  practices: typeof practices;
  practitionerAssociations: typeof practitionerAssociations;
  publicHolidays: typeof publicHolidays;
  recursiveValidator: typeof recursiveValidator;
  ruleEngine: typeof ruleEngine;
  ruleSetDiff: typeof ruleSetDiff;
  ruleSetEntityDeletion: typeof ruleSetEntityDeletion;
  ruleSetLifecycle: typeof ruleSetLifecycle;
  ruleSetValidation: typeof ruleSetValidation;
  ruleSets: typeof ruleSets;
  scheduling: typeof scheduling;
  schedulingCore: typeof schedulingCore;
  scopedResources: typeof scopedResources;
  telefonki: typeof telefonki;
  temporaryPatients: typeof temporaryPatients;
  "tests/test_utils": typeof tests_test_utils;
  typedDtos: typeof typedDtos;
  userIdentity: typeof userIdentity;
  users: typeof users;
  vacations: typeof vacations;
  validators: typeof validators;
  workosOrganizations: typeof workosOrganizations;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workOSAuthKit: import("@convex-dev/workos-authkit/_generated/component.js").ComponentApi<"workOSAuthKit">;
};
