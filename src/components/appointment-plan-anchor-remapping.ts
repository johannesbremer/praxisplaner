const ROOT_STEP_ID = "root";
const STEP_ID_PREFIX = "step-";

export function appointmentPlanStepIdForIndex(index: number): string {
  return `${STEP_ID_PREFIX}${index + 1}`;
}

export function remapAppointmentPlanAnchorStepId(args: {
  anchorStepId: string;
  nextStepIndex: number;
  nextSteps: readonly object[];
  previousSteps: readonly object[];
}): string {
  if (args.anchorStepId === ROOT_STEP_ID) {
    return ROOT_STEP_ID;
  }

  const previousAnchorIndex = parseAppointmentPlanAnchorIndex(
    args.anchorStepId,
  );
  if (previousAnchorIndex === undefined) {
    return ROOT_STEP_ID;
  }

  const anchoredStep = args.previousSteps[previousAnchorIndex];
  if (!anchoredStep) {
    return ROOT_STEP_ID;
  }

  const nextAnchorIndex = args.nextSteps.indexOf(anchoredStep);
  if (nextAnchorIndex === -1 || nextAnchorIndex >= args.nextStepIndex) {
    return ROOT_STEP_ID;
  }

  return appointmentPlanStepIdForIndex(nextAnchorIndex);
}

function parseAppointmentPlanAnchorIndex(anchorStepId: string) {
  if (!anchorStepId.startsWith(STEP_ID_PREFIX)) {
    return;
  }

  const stepNumber = Number(anchorStepId.slice(STEP_ID_PREFIX.length));
  if (!Number.isInteger(stepNumber) || stepNumber < 1) {
    return;
  }

  return stepNumber - 1;
}
