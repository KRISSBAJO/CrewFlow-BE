import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { CreateStaffDto } from './dto/create-staff.dto';
import { TenantsService } from './tenants.service';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';

@Controller('tenant')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  getProfile(@CurrentUser() user: AuthUser) {
    return this.tenants.getProfile(user.tenantId);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Patch()
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTenantSettingsDto,
  ) {
    return this.tenants.updateSettings(user.tenantId, dto);
  }

  @Get('onboarding')
  getOnboarding(@CurrentUser() user: AuthUser) {
    return this.tenants.getOnboarding(user.tenantId);
  }

  @Get('staff')
  listStaff(@CurrentUser() user: AuthUser) {
    return this.tenants.listStaff(user.tenantId);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('staff')
  createStaff(@CurrentUser() user: AuthUser, @Body() dto: CreateStaffDto) {
    return this.tenants.createStaff(user.tenantId, dto);
  }
}
