import type {
  RuleSetCommand,
  RuleSetCommandDescription,
  RuleSetCommandKind,
  RuleSetReplayAdapter,
} from "./rule-set-replay";

type RuleSetReplayRegistry = Partial<
  Record<RuleSetCommandKind, WeakMap<RuleSetCommand, RuleSetReplayAdapter>>
>;

const replayAdaptersByKind: RuleSetReplayRegistry = {};

export function getRegisteredRuleSetReplayAdapter(
  command: RuleSetCommand,
): RuleSetReplayAdapter | undefined {
  return replayAdaptersByKind[command.kind]?.get(command);
}

export function registerRuleSetReplayAdapter(
  command: RuleSetCommandDescription,
  replay: RuleSetReplayAdapter,
): RuleSetCommand {
  const replayAdapters =
    replayAdaptersByKind[command.kind] ??
    new WeakMap<RuleSetCommand, RuleSetReplayAdapter>();
  replayAdapters.set(command, replay);
  replayAdaptersByKind[command.kind] = replayAdapters;
  return command;
}
