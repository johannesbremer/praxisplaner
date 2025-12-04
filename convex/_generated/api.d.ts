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
import type * as copyOnWrite from "../copyOnWrite.js";
import type * as entities from "../entities.js";
import type * as gdt_processing from "../gdt/processing.js";
import type * as gdt_types from "../gdt/types.js";
import type * as gdt_validation from "../gdt/validation.js";
import type * as patients from "../patients.js";
import type * as practices from "../practices.js";
import type * as ruleEngine from "../ruleEngine.js";
import type * as ruleSets from "../ruleSets.js";
import type * as scheduling from "../scheduling.js";
import type * as temporaryPatients from "../temporaryPatients.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appointments: typeof appointments;
  copyOnWrite: typeof copyOnWrite;
  entities: typeof entities;
  "gdt/processing": typeof gdt_processing;
  "gdt/types": typeof gdt_types;
  "gdt/validation": typeof gdt_validation;
  patients: typeof patients;
  practices: typeof practices;
  ruleEngine: typeof ruleEngine;
  ruleSets: typeof ruleSets;
  scheduling: typeof scheduling;
  temporaryPatients: typeof temporaryPatients;
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

export declare const components: {};
