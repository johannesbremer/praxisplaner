export interface LineageTrackedEntity<TId extends string> {
  _id: TId;
  lineageKey?: TId;
}

interface ResolveReplayEntityConflict {
  message: string;
  status: "conflict";
}

interface ResolveReplayEntityParams<
  TId extends string,
  TEntity extends LineageTrackedEntity<TId>,
> {
  currentEntityId: TId;
  entities: readonly TEntity[];
  lineageKey: TId;
  missingMessage: string;
}

type ResolveReplayEntityResult<
  TId extends string,
  TEntity extends LineageTrackedEntity<TId>,
> = ResolveReplayEntityConflict | ResolveReplayEntitySuccess<TId, TEntity>;

interface ResolveReplayEntitySuccess<
  TId extends string,
  TEntity extends LineageTrackedEntity<TId>,
> {
  currentEntityId: TId;
  entity: TEntity;
  status: "ok";
}

export function resolveReplayEntity<
  TId extends string,
  TEntity extends LineageTrackedEntity<TId>,
>(
  params: ResolveReplayEntityParams<TId, TEntity>,
): ResolveReplayEntityResult<TId, TEntity> {
  const byId = params.entities.find(
    (entity) => entity._id === params.currentEntityId,
  );
  if (byId) {
    return {
      currentEntityId: byId._id,
      entity: byId,
      status: "ok",
    };
  }

  const byLineage = params.entities.find(
    (entity) => entity.lineageKey === params.lineageKey,
  );
  if (byLineage) {
    return {
      currentEntityId: byLineage._id,
      entity: byLineage,
      status: "ok",
    };
  }

  return {
    message: params.missingMessage,
    status: "conflict",
  };
}
