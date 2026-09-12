import { SetMetadata } from '@nestjs/common';
import { RoleEnum } from '@repo/shared-types';

export const ROLES_KEY = 'ROLES';
export const Roles = (...roles: RoleEnum[]) => SetMetadata(ROLES_KEY, roles);
