import { Controller, Get, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { DashboardService } from './dashboard.service';

@Roles(UserRole.OWNER, UserRole.MANAGER)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  summary(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.dashboard.summary(user.tenantId, from, to);
  }

  @Get('weekly-digest')
  weeklyDigest(@CurrentUser() user: AuthUser) {
    return this.dashboard.weeklyDigest(user);
  }

  @Roles(UserRole.OWNER)
  @Post('weekly-digest/send')
  sendWeeklyDigest(@CurrentUser() user: AuthUser) {
    return this.dashboard.sendWeeklyDigest(user);
  }
}
