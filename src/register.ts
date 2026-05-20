import { ORM, type OrmRootResolverRegistration } from '@connectingmatrix/orm';
import { registerFileServiceGraphqlOperations } from './agent-files/register-graphql-operations';

type RootRegistrar = {
  registerRootResolver(registration: OrmRootResolverRegistration): OrmRootResolverRegistration;
  registerRootResolvers(registrations: readonly OrmRootResolverRegistration[]): void;
};

export function registerFileServicePackage(orm: RootRegistrar = ORM): void {
  registerFileServiceGraphqlOperations(orm);
}
