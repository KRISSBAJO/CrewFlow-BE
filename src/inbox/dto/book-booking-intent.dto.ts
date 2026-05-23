import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class BookBookingIntentDto {
  @ApiProperty({ example: '2026-05-24T15:00:00.000Z' })
  @IsDateString()
  startTime: string;

  @ApiPropertyOptional({ example: 'clx_staff_id' })
  @IsOptional()
  @IsString()
  assignedStaffId?: string;

  @ApiPropertyOptional({
    enum: BookingStatus,
    example: BookingStatus.CONFIRMED,
  })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({
    example: 'Booked from AI receptionist intake after customer confirmed.',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
