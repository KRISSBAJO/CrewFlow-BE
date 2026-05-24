import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { CommunicationsService } from './communications.service';
import { SendBookingUpdateDto } from './dto/send-booking-update.dto';

@Controller('communications')
export class CommunicationsController {
  constructor(private readonly communications: CommunicationsService) {}

  @Get('health')
  health(@CurrentUser() user: AuthUser) {
    return this.communications.health(user);
  }

  @Get('bookings/:bookingId')
  bookingTimeline(
    @CurrentUser() user: AuthUser,
    @Param('bookingId') bookingId: string,
  ) {
    return this.communications.bookingTimeline(user, bookingId);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('bookings/:bookingId/send')
  sendBookingUpdate(
    @CurrentUser() user: AuthUser,
    @Param('bookingId') bookingId: string,
    @Body() dto: SendBookingUpdateDto,
  ) {
    return this.communications.sendBookingUpdate(user, bookingId, dto);
  }
}
