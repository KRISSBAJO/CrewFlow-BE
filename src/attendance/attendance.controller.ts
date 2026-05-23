import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { AttendanceService } from './attendance.service';
import { CheckInDto } from './dto/check-in.dto';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('check-in')
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: CheckInDto) {
    return this.attendance.checkIn(user.tenantId, user.sub, dto);
  }

  @Post('check-out')
  checkOut(@CurrentUser() user: AuthUser) {
    return this.attendance.checkOut(user.tenantId, user.sub);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    return this.attendance.findAll(user.tenantId, date);
  }
}
