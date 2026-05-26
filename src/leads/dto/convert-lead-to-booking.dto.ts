import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';

export class ConvertLeadToBookingDto {
  @ApiProperty({ example: 'clx_service_id' })
  @IsString()
  serviceId: string;

  @ApiPropertyOptional({ example: 'clx_staff_id' })
  @IsOptional()
  @IsString()
  assignedStaffId?: string;

  @ApiProperty({ example: '2026-05-29T15:00:00.000Z' })
  @IsDateString()
  startTime: string;

  @ApiPropertyOptional({
    enum: BookingStatus,
    example: BookingStatus.CONFIRMED,
  })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({
    example: 'Converted from lead after customer confirmed availability.',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
