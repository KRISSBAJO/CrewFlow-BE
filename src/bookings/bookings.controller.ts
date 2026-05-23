import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    return this.bookings.create(user, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('assignedStaffId') assignedStaffId?: string,
  ) {
    return this.bookings.findAll(user, from, to, assignedStaffId);
  }

  @Get('my-schedule')
  mySchedule(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.bookings.mySchedule(user, from, to);
  }

  @Get('staff/:staffId/schedule')
  staffSchedule(
    @CurrentUser() user: AuthUser,
    @Param('staffId') staffId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.bookings.staffSchedule(user, staffId, from, to);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBookingDto,
  ) {
    return this.bookings.update(user, id, dto);
  }

  @Post(':id/on-the-way')
  markOnTheWay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.markOnTheWay(user, id);
  }

  @Post(':id/no-show')
  markNoShow(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.markNoShow(user, id);
  }

  @Post(':id/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookings.complete(user, id);
  }
}
