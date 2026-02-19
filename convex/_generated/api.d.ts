/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appointments from "../appointments.js";
import type * as auth from "../auth.js";
import type * as bookingSessions from "../bookingSessions.js";
import type * as copyOnWrite from "../copyOnWrite.js";
import type * as entities from "../entities.js";
import type * as gdt_processing from "../gdt/processing.js";
import type * as gdt_types from "../gdt/types.js";
import type * as gdt_validation from "../gdt/validation.js";
import type * as http from "../http.js";
import type * as patients from "../patients.js";
import type * as practiceAccess from "../practiceAccess.js";
import type * as practices from "../practices.js";
import type * as ruleEngine from "../ruleEngine.js";
import type * as ruleSetValidation from "../ruleSetValidation.js";
import type * as ruleSets from "../ruleSets.js";
import type * as scheduling from "../scheduling.js";
import type * as tests_test_utils from "../tests/test_utils.js";
import type * as userIdentity from "../userIdentity.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appointments: typeof appointments;
  auth: typeof auth;
  bookingSessions: typeof bookingSessions;
  copyOnWrite: typeof copyOnWrite;
  entities: typeof entities;
  "gdt/processing": typeof gdt_processing;
  "gdt/types": typeof gdt_types;
  "gdt/validation": typeof gdt_validation;
  http: typeof http;
  patients: typeof patients;
  practiceAccess: typeof practiceAccess;
  practices: typeof practices;
  ruleEngine: typeof ruleEngine;
  ruleSetValidation: typeof ruleSetValidation;
  ruleSets: typeof ruleSets;
  scheduling: typeof scheduling;
  "tests/test_utils": typeof tests_test_utils;
  userIdentity: typeof userIdentity;
  users: typeof users;
  validators: typeof validators;
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
  workOSAuthKit: {
    lib: {
      enqueueWebhookEvent: FunctionReference<
        "mutation",
        "internal",
        {
          apiKey: string;
          event: string;
          eventId: string;
          eventTypes?: Array<string>;
          logLevel?: "DEBUG";
          onEventHandle?: string;
          updatedAt?: string;
        },
        any
      >;
      getAuthUser: FunctionReference<
        "query",
        "internal",
        { id: string },
        {
          createdAt: string;
          email: string;
          emailVerified: boolean;
          externalId?: null | string;
          firstName?: null | string;
          id: string;
          lastName?: null | string;
          lastSignInAt?: null | string;
          locale?: null | string;
          metadata: Record<string, any>;
          profilePictureUrl?: null | string;
          updatedAt: string;
        } | null
      >;
    };
  };
};
