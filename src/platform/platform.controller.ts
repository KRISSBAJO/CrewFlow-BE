import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { PlatformService } from './platform.service';

@ApiTags('platform')
@ApiBearerAuth()
@Roles(UserRole.PLATFORM_ADMIN)
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('metrics')
  metrics() {
    return this.platform.metrics();
  }

  @Get('tenants')
  tenants() {
    return this.platform.tenants();
  }

  @Get('tenants/:id')
  tenant(@Param('id') id: string) {
    return this.platform.tenant(id);
  }

  @Patch('tenants/:id')
  updateTenant(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTenantStatusDto,
  ) {
    return this.platform.updateTenant(user, id, dto);
  }

  @Get('automation-failures')
  automationFailures() {
    return this.platform.automationFailures();
  }

  @Get('webhook-failures')
  webhookFailures() {
    return this.platform.webhookFailures();
  }

  @Get('audit')
  audit() {
    return this.platform.auditLogs();
  }
}
