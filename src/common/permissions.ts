import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser } from './current-user.decorator';

export function isManager(user: AuthUser): boolean {
  return user.role === UserRole.OWNER || user.role === UserRole.MANAGER;
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
