<<<<<<< ours
import { err, ok, Result } from "neverthrow";

||||||| base
import { err, ok, type Result } from "neverthrow";

=======
>>>>>>> theirs
import type { Id, TableNames } from "@/convex/_generated/dataModel";
import type { EntityId, LineageKey } from "@/convex/identity";

import { asEntityId, asLineageKey } from "@/convex/identity";

export type FrontendLineageEntity<
  TableName extends FrontendLineageTableName,
  TEntity extends FrontendLineageRecord<TableName>,
> = Omit<TEntity, "_id" | "lineageKey"> & {
  _id: EntityId<TableName>;
  lineageKey: LineageKey<TableName>;
};

interface FrontendLineageRecord<TableName extends FrontendLineageTableName> {
  _id: Id<TableName>;
  lineageKey: Id<TableName>;
}

type FrontendLineageTableName = Extract<
  TableNames,
  | "appointmentTypes"
  | "baseSchedules"
  | "locations"
  | "mfas"
  | "practitioners"
  | "vacations"
>;

export function buildFrontendLineageIndex<
  TableName extends FrontendLineageTableName,
  TEntity extends {
    _id: EntityId<TableName>;
    lineageKey: LineageKey<TableName>;
  },
>(entities: TEntity[]) {
  return {
    byEntityId: new Map(
      entities.map((entity) => [entity._id, entity] as const),
    ),
    byLineageKey: new Map(
      entities.map((entity) => [entity.lineageKey, entity] as const),
    ),
  };
}

export function findFrontendEntityByEntityId<
  TableName extends FrontendLineageTableName,
  TEntity extends {
    _id: EntityId<TableName>;
    lineageKey: LineageKey<TableName>;
  },
>(entities: TEntity[], entityId: EntityId<TableName>): TEntity | undefined {
  return entities.find((entity) => entity._id === entityId);
}

export function findFrontendEntityByLineageKey<
  TableName extends FrontendLineageTableName,
  TEntity extends {
    _id: EntityId<TableName>;
    lineageKey: LineageKey<TableName>;
  },
>(entities: TEntity[], lineageKey: LineageKey<TableName>): TEntity | undefined {
  return entities.find((entity) => entity.lineageKey === lineageKey);
}

export function mapFrontendLineageEntities<
  TableName extends FrontendLineageTableName,
  TEntity extends FrontendLineageRecord<TableName>,
<<<<<<< ours
>(params: {
  entities: TEntity[];
  entityType: string;
  source: string;
}): Result<
  FrontendLineageEntity<TableName, TEntity>[],
  ReturnType<typeof invalidStateError>
> {
  return Result.combine(
    params.entities.map((entity) =>
      toFrontendLineageEntity<TableName, TEntity>({
        entity,
        entityType: params.entityType,
        source: params.source,
      }).mapErr((error) => {
        captureFrontendError(
          error,
          {
            context: "map_frontend_lineage_entities",
            entityId: entity._id,
            entityType: params.entityType,
            source: params.source,
          },
          `${params.source}:${params.entityType}:${entity._id}:lineage`,
        );

        return error;
      }),
    ),
  );
}

export function requireFrontendLineageKey<
  TableName extends FrontendLineageTableName,
>(params: {
  entity: FrontendLineageRecord<TableName>;
  entityType: string;
  source: string;
}): Result<LineageKey<TableName>, ReturnType<typeof invalidStateError>> {
  if (!params.entity.lineageKey) {
    return err(
      invalidStateError(
        `[FRONTEND:LINEAGE_KEY_MISSING] ${params.entityType} ${params.entity._id} hat keinen lineageKey.`,
        params.source,
      ),
    );
  }

  return ok(asLineageKey(params.entity.lineageKey));
||||||| base
>(params: {
  entities: TEntity[];
  entityType: string;
  source: string;
}): FrontendLineageEntity<TableName, TEntity>[] {
  const mappedEntities: FrontendLineageEntity<TableName, TEntity>[] = [];

  for (const entity of params.entities) {
    toFrontendLineageEntity<TableName, TEntity>({
      entity,
      entityType: params.entityType,
      source: params.source,
    }).match(
      (frontendEntity) => {
        mappedEntities.push(frontendEntity);
      },
      (error) => {
        captureFrontendError(
          error,
          {
            context: "map_frontend_lineage_entities",
            entityId: entity._id,
            entityType: params.entityType,
            source: params.source,
          },
          `${params.source}:${params.entityType}:${entity._id}:lineage`,
        );
      },
    );
  }

  return mappedEntities;
}

export function requireFrontendLineageKey<
  TableName extends FrontendLineageTableName,
>(params: {
  entity: FrontendLineageRecord<TableName>;
  entityType: string;
  source: string;
}): Result<LineageKey<TableName>, ReturnType<typeof invalidStateError>> {
  if (!params.entity.lineageKey) {
    return err(
      invalidStateError(
        `[FRONTEND:LINEAGE_KEY_MISSING] ${params.entityType} ${params.entity._id} hat keinen lineageKey.`,
        params.source,
      ),
    );
  }

  return ok(asLineageKey(params.entity.lineageKey));
=======
>(entities: TEntity[]): FrontendLineageEntity<TableName, TEntity>[] {
  return entities.map((entity) => toFrontendLineageEntity(entity));
>>>>>>> theirs
}

export function toFrontendLineageEntity<
  TableName extends FrontendLineageTableName,
  TEntity extends FrontendLineageRecord<TableName>,
>(entity: TEntity): FrontendLineageEntity<TableName, TEntity> {
  return {
    ...entity,
    _id: asEntityId(entity._id),
    lineageKey: asLineageKey(entity.lineageKey),
  };
}
