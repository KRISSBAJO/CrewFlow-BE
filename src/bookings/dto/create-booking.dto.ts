import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class InlineCustomerDto {
  @ApiProperty({ example: 'Nia Carter' })
  @IsString()
  name: string;

  @ApiProperty({ example: '+15550102020' })
  @IsString()
  phone: string;

  @ApiPropertyOptional({ example: 'nia@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'Prefers WhatsApp.' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateBookingDto {
  @ApiPropertyOptional({ example: 'clx_customer_id' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ type: InlineCustomerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => InlineCustomerDto)
  inlineCustomer?: InlineCustomerDto;

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

  @ApiPropertyOptional({
    example: 'weekly',
    enum: ['none', 'weekly', 'biweekly', 'monthly'],
  })
  @IsOptional()
  @IsIn(['none', 'weekly', 'biweekly', 'monthly'])
  repeatFrequency?: 'none' | 'weekly' | 'biweekly' | 'monthly';

  @ApiPropertyOptional({ example: 4, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  repeatCount?: number;
}
