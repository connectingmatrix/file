import { ORM, type EntityClass } from '@connectingmatrix/orm';
import { fileServiceEntities } from './entities/registry';
import { registerFileServiceGraphqlOperations } from './agent-files/register-graphql-operations';

type RootRegistrar = Parameters<typeof registerFileServiceGraphqlOperations>[0];
type OrmRegistrar = RootRegistrar & { registerEntity<TEntity extends EntityClass>(entity: TEntity): TEntity };

export function registerFileServicePackage(orm: OrmRegistrar = ORM as OrmRegistrar): EntityClass[] {
  for (const entity of fileServiceEntities) orm.registerEntity(entity);
  registerFileServiceGraphqlOperations(orm);
  return [...fileServiceEntities];
}

export { fileServiceEntities };
