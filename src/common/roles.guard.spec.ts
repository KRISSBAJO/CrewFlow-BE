import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { IS_PUBLIC_KEY } from './public.decorator';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './roles.decorator';

function context(role?: UserRole): ExecutionContext {
  return {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({
      getRequest: () => ({
        user: role
          ? {
              sub: 'user-id',
              tenantId: 'tenant-id',
              email: 'user@example.com',
              role,
            }
          : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows public routes without a user', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === IS_PUBLIC_KEY ? true : undefined,
      ),
    } as unknown as Reflector;

    expect(new RolesGuard(reflector).canActivate(context())).toBe(true);
  });

  it('defaults unannotated routes to tenant users', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === IS_PUBLIC_KEY ? false : undefined,
      ),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(context(UserRole.OWNER))).toBe(true);
    expect(guard.canActivate(context(UserRole.MANAGER))).toBe(true);
    expect(guard.canActivate(context(UserRole.STAFF))).toBe(true);
    expect(guard.canActivate(context(UserRole.PLATFORM_ADMIN))).toBe(false);
    expect(guard.canActivate(context(UserRole.PLATFORM_SUPPORT))).toBe(false);
  });

  it('honors explicit platform role metadata', () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY) {
          return [UserRole.PLATFORM_ADMIN, UserRole.PLATFORM_SUPPORT];
        }
        return undefined;
      }),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(context(UserRole.PLATFORM_ADMIN))).toBe(true);
    expect(guard.canActivate(context(UserRole.PLATFORM_SUPPORT))).toBe(true);
    expect(guard.canActivate(context(UserRole.OWNER))).toBe(false);
  });
});
