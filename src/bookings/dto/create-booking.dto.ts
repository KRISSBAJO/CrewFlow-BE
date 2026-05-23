import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: 'clx_customer_id' })
  @IsString()
  customerId: string;

  @ApiProperty({ example: 'clx_service_id' })
  @IsString()
  serviceId: string;

  @ApiPropertyOptional({ example: 'clx_staff_id' })
  @IsOptional()
  @IsString()
  assignedStaffId?: string;

  @ApiProperty({ example: '2026-05-23T15:00:00.000Z' })
  @IsDateString()
  startTime: string;

  @ApiPropertyOptional({
    enum: BookingStatus,
    example: BookingStatus.CONFIRMED,
  })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ example: 'web_chat' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({
    example: 'Customer asked for kitchen focus and WhatsApp reminders.',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
