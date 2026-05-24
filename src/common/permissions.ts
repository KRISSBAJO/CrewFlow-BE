import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser } from './current-user.decorator';

export function isManager(user: AuthUser): boolean {
  return user.role === UserRole.OWNER || user.role === UserRole.MANAGER;
}

export function isTenantUser(user: AuthUser): boolean {
  return (
    user.role === UserRole.OWNER ||
    user.role === UserRole.MANAGER ||
    user.role === UserRole.STAFF
  );
}

export function isPlatformUser(user: AuthUser): boolean {
  return (
    user.role === UserRole.PLATFORM_ADMIN ||
    user.role === UserRole.PLATFORM_SUPPORT
  );
}

export function assertTenantUser(user: AuthUser): void {
  if (!isTenantUser(user)) {
    throw new ForbiddenException('Tenant access required');
  }
}

export function assertPlatformAdmin(user: AuthUser): void {
  if (user.role !== UserRole.PLATFORM_ADMIN) {
    throw new ForbiddenException('Platform admin access required');
  }
}

export function assertManager(user: AuthUser): void {
  if (!isManager(user)) {
    throw new ForbiddenException('Manager access required');
  }
}

export function assertOwner(user: AuthUser): void {
  if (user.role !== UserRole.OWNER) {
    throw new ForbiddenException('Owner access required');
  }
}
