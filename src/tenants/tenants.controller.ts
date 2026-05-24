import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { CreateStaffDto } from './dto/create-staff.dto';
import { TenantsService } from './tenants.service';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

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

  @Get('whatsapp/onboarding')
  whatsappOnboarding(@CurrentUser() user: AuthUser) {
    return this.tenants.whatsappOnboarding(user.tenantId);
  }

  @Get('activation')
  activation(@CurrentUser() user: AuthUser) {
    return this.tenants.activation(user);
  }

  @Get('billing')
  billing(@CurrentUser() user: AuthUser) {
    return this.tenants.billing(user);
  }

  @Roles(UserRole.OWNER)
  @Post('billing/checkout')
  createBillingCheckout(@CurrentUser() user: AuthUser) {
    return this.tenants.createBillingCheckout(user);
  }

  @Roles(UserRole.OWNER)
  @Post('billing/portal')
  createBillingPortal(@CurrentUser() user: AuthUser) {
    return this.tenants.createBillingPortal(user);
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

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Patch('staff/:id')
  updateStaff(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.tenants.updateStaff(user.tenantId, id, dto);
  }
}
