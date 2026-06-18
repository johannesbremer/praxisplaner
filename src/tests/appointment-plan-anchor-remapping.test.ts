import { describe, expect, test } from "vitest";

import { remapAppointmentPlanAnchorStepId } from "../components/appointment-plan-anchor-remapping";

describe("appointment plan anchor remapping", () => {
  test("keeps anchors pointing at the same logical step after reorder", () => {
    const firstStep = {};
    const secondStep = {};
    const anchoredStep = {};
    const previousSteps = [firstStep, secondStep, anchoredStep];
    const nextSteps = [secondStep, firstStep, anchoredStep];

    expect(
      remapAppointmentPlanAnchorStepId({
        anchorStepId: "step-1",
        nextStepIndex: 2,
        nextSteps,
        previousSteps,
      }),
    ).toBe("step-2");
  });

  test("shifts anchors when earlier steps are removed", () => {
    const removedStep = {};
    const anchoredStep = {};
    const dependentStep = {};
    const previousSteps = [removedStep, anchoredStep, dependentStep];
    const nextSteps = [anchoredStep, dependentStep];

    expect(
      remapAppointmentPlanAnchorStepId({
        anchorStepId: "step-2",
        nextStepIndex: 1,
        nextSteps,
        previousSteps,
      }),
    ).toBe("step-1");
  });

  test("resets anchors that were removed or would point to self/future", () => {
    const removedAnchorStep = {};
    const dependentStep = {};
    const laterAnchorStep = {};
    const previousSteps = [removedAnchorStep, dependentStep, laterAnchorStep];

    expect(
      remapAppointmentPlanAnchorStepId({
        anchorStepId: "step-1",
        nextStepIndex: 0,
        nextSteps: [dependentStep, laterAnchorStep],
        previousSteps,
      }),
    ).toBe("root");

    expect(
      remapAppointmentPlanAnchorStepId({
        anchorStepId: "step-1",
        nextStepIndex: 0,
        nextSteps: [dependentStep, removedAnchorStep, laterAnchorStep],
        previousSteps: [removedAnchorStep, dependentStep, laterAnchorStep],
      }),
    ).toBe("root");
  });
});
