import type { TelefonkiSearchRequest } from "./agent-state";

export interface TelefonkiSearchExecutor<
  TPracticeId extends string,
  TSimulatedContext extends TelefonkiSimulatedContext,
  TSlot,
> {
  availableSlotsOnDate(args: {
    date: string;
    integrationSecret: string;
    limit: number;
    practiceId: TPracticeId;
    simulatedContext: TSimulatedContext;
  }): Promise<readonly TSlot[]>;
  nextAvailableAfternoonSlot(args: {
    integrationSecret: string;
    practiceId: TPracticeId;
    simulatedContext: TSimulatedContext;
  }): Promise<null | TSlot>;
  nextAvailableAfternoonSlots(args: {
    integrationSecret: string;
    limit: number;
    practiceId: TPracticeId;
    simulatedContext: TSimulatedContext;
  }): Promise<readonly TSlot[]>;
  nextAvailableSlot(args: {
    integrationSecret: string;
    practiceId: TPracticeId;
    simulatedContext: TSimulatedContext;
  }): Promise<null | TSlot>;
  nextAvailableSlots(args: {
    integrationSecret: string;
    limit: number;
    practiceId: TPracticeId;
    simulatedContext: TSimulatedContext;
  }): Promise<readonly TSlot[]>;
}

export interface TelefonkiSimulatedContext {
  appointmentTypeLineageKey: string;
  locationLineageKey: string;
  patient: {
    dateOfBirth?: string;
    isNew: boolean;
  };
  practitionerLineageKey?: string;
}

export async function executeTelefonkiSearch<
  TPracticeId extends string,
  TSimulatedContext extends TelefonkiSimulatedContext,
  TSlot,
>(args: {
  executor: TelefonkiSearchExecutor<TPracticeId, TSimulatedContext, TSlot>;
  integrationSecret: string;
  practiceId: TPracticeId;
  searchRequest: TelefonkiSearchRequest;
  simulatedContext: TSimulatedContext;
}): Promise<TSlot[]> {
  switch (args.searchRequest.kind) {
    case "availableSlotsOnDate": {
      return [
        ...(await args.executor.availableSlotsOnDate({
          date: args.searchRequest.date,
          integrationSecret: args.integrationSecret,
          limit: args.searchRequest.limit,
          practiceId: args.practiceId,
          simulatedContext: args.simulatedContext,
        })),
      ];
    }
    case "nextAvailableAfternoonSlot": {
      const slot = await args.executor.nextAvailableAfternoonSlot({
        integrationSecret: args.integrationSecret,
        practiceId: args.practiceId,
        simulatedContext: args.simulatedContext,
      });
      return slot ? [slot] : [];
    }
    case "nextAvailableAfternoonSlots": {
      return [
        ...(await args.executor.nextAvailableAfternoonSlots({
          integrationSecret: args.integrationSecret,
          limit: args.searchRequest.limit,
          practiceId: args.practiceId,
          simulatedContext: args.simulatedContext,
        })),
      ];
    }
    case "nextAvailableSlot": {
      const slot = await args.executor.nextAvailableSlot({
        integrationSecret: args.integrationSecret,
        practiceId: args.practiceId,
        simulatedContext: args.simulatedContext,
      });
      return slot ? [slot] : [];
    }
    case "nextAvailableSlots": {
      return [
        ...(await args.executor.nextAvailableSlots({
          integrationSecret: args.integrationSecret,
          limit: args.searchRequest.limit,
          practiceId: args.practiceId,
          simulatedContext: args.simulatedContext,
        })),
      ];
    }
  }
}
