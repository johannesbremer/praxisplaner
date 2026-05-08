import { z } from "zod";

interface JobMetadata {
  caller_number?: string;
  phoneNumber?: string;
}

interface ParticipantSnapshot {
  attributes: Record<string, string | undefined>;
  metadata?: string | undefined;
}

interface ResolvedCallRouting {
  callerPhoneNumber?: string;
  dialedPracticePhoneNumber?: string;
}

export function resolveCallRouting(
  participant: ParticipantSnapshot,
  jobMetadata?: string,
): ResolvedCallRouting {
  const parsedJobMetadata = parseJobMetadata(jobMetadata);
  const parsedParticipantMetadata = parseParticipantMetadata(
    participant.metadata,
  );

  const callerPhoneNumber =
    participant.attributes["sip.phoneNumber"] ??
    parsedParticipantMetadata.callerPhoneNumber ??
    parsedJobMetadata.caller_number ??
    parsedJobMetadata.phoneNumber;

  const dialedPracticePhoneNumber =
    participant.attributes["sip.trunkPhoneNumber"];

  return {
    ...(callerPhoneNumber !== undefined && { callerPhoneNumber }),
    ...(dialedPracticePhoneNumber !== undefined && {
      dialedPracticePhoneNumber,
    }),
  };
}

function parseJobMetadata(metadata: string | undefined): JobMetadata {
  if (!metadata) {
    return {};
  }

  try {
    const parsed = z
      .looseObject({
        caller_number: z.string().optional(),
        phoneNumber: z.string().optional(),
      })
      .parse(JSON.parse(metadata));

    return {
      ...(parsed.caller_number !== undefined && {
        caller_number: parsed.caller_number,
      }),
      ...(parsed.phoneNumber !== undefined && {
        phoneNumber: parsed.phoneNumber,
      }),
    };
  } catch {
    return {};
  }
}

function parseParticipantMetadata(metadata: string | undefined): {
  callerPhoneNumber?: string;
} {
  if (!metadata) {
    return {};
  }

  try {
    const parsed = z
      .looseObject({
        sip: z
          .object({
            caller_number: z.string().optional(),
          })
          .optional(),
      })
      .parse(JSON.parse(metadata));

    return {
      ...(parsed.sip?.caller_number !== undefined && {
        callerPhoneNumber: parsed.sip.caller_number,
      }),
    };
  } catch {
    return {};
  }
}
