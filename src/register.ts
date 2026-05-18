import { ORM } from '@connectingmatrix/orm';
import { fileServiceEntities } from './entities/registry';

type OrmRegistrar = { registerEntity(entity: Function): unknown };

export function registerFileServicePackage(orm: OrmRegistrar = ORM): Function[] {
  for (const entity of fileServiceEntities) orm.registerEntity(entity);
  return [...fileServiceEntities];
}

export { fileServiceEntities };
