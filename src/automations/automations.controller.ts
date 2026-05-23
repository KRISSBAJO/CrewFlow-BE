import { Body, Controller, Get, Post } from '@nestjs/common';
import { Query, Param } from '@nestjs/common';
import {
  AutomationRunStatus,
  AutomationTrigger,
  UserRole,
} from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { AutomationsService } from './automations.service';
import { RetryAutomationRunDto } from './dto/retry-automation-run.dto';
import { UpsertAutomationDto } from './dto/upsert-automation.dto';

@Controller('automations')
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.automations.findAll(user.tenantId);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post()
  upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertAutomationDto) {
    return this.automations.upsert(user.tenantId, dto);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('runs')
  findRuns(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: AutomationRunStatus,
    @Query('trigger') trigger?: AutomationTrigger,
  ) {
    return this.automations.findRuns(user.tenantId, status, trigger);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('runs/:id/retry')
  retry(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RetryAutomationRunDto,
  ) {
    return this.automations.retry(user.tenantId, id, user.sub, dto.reason);
  }
}
