import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/public.decorator';
import { BookingPortalService } from './booking-portal.service';
import { CreatePortalBookingDto } from './dto/create-portal-booking.dto';

@ApiTags('Customer booking portal')
@Controller('portal')
export class BookingPortalController {
  constructor(private readonly portal: BookingPortalService) {}

  @Public()
  @Get(':slug')
  @ApiOperation({
    summary: 'Public customer booking page data',
    description:
      'Returns active services and tenant details needed for a customer booking page.',
  })
  getPortal(@Param('slug') slug: string) {
    return this.portal.getPortal(slug);
  }

  @Public()
  @Post(':slug/book')
  @ApiOperation({
    summary: 'Create a public customer booking',
    description:
      'Creates or updates the customer, books the selected service, and can generate an invoice checkout link.',
  })
  createBooking(
    @Param('slug') slug: string,
    @Body() dto: CreatePortalBookingDto,
  ) {
    return this.portal.createBooking(slug, dto);
  }
}
