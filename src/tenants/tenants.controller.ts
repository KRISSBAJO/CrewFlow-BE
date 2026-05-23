import { Body, Controller, Get, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { CreateStaffDto } from './dto/create-staff.dto';
import { TenantsService } from './tenants.service';

@Controller('tenant')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  getProfile(@CurrentUser() user: AuthUser) {
    return this.tenants.getProfile(user.tenantId);
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
