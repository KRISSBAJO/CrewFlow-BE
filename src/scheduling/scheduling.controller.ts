import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { SchedulingService } from './scheduling.service';

@Controller()
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Public()
  @Get('portal/:slug/availability')
  publicAvailability(
    @Param('slug') slug: string,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
  ) {
    return this.scheduling.publicAvailability(slug, serviceId, date);
  }

  @Get('scheduling/availability')
  availability(
    @CurrentUser() user: AuthUser,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
  ) {
    return this.scheduling.tenantAvailability(user.tenantId, serviceId, date);
  }

  @Get('scheduling/conflicts')
  conflicts(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    return this.scheduling.conflicts(user.tenantId, date);
  }

  @Get('scheduling/staff-suggestions')
  staffSuggestions(
    @CurrentUser() user: AuthUser,
    @Query('serviceId') serviceId: string,
    @Query('startTime') startTime: string,
  ) {
    return this.scheduling.staffSuggestions(
      user.tenantId,
      serviceId,
      startTime,
    );
  }
}
