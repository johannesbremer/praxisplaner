import { expectTypeOf, test } from "vitest";

import type {
  AppointmentTypeId,
  AppointmentTypeLineageKey,
  LocationId,
  LocationLineageKey,
  PractitionerId,
  PractitionerLineageKey,
  VacationId,
  VacationLineageKey,
} from "../../convex/identity";

test("entity ids and lineage keys are distinct types", () => {
  expectTypeOf<AppointmentTypeLineageKey>().not.toExtend<AppointmentTypeId>();
  expectTypeOf<AppointmentTypeId>().not.toExtend<AppointmentTypeLineageKey>();

  expectTypeOf<LocationLineageKey>().not.toExtend<LocationId>();
  expectTypeOf<LocationId>().not.toExtend<LocationLineageKey>();

  expectTypeOf<PractitionerLineageKey>().not.toExtend<PractitionerId>();
  expectTypeOf<PractitionerId>().not.toExtend<PractitionerLineageKey>();

  expectTypeOf<VacationLineageKey>().not.toExtend<VacationId>();
  expectTypeOf<VacationId>().not.toExtend<VacationLineageKey>();
});
