import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePortalBookingDto {
  @ApiProperty({ example: 'clv_service_123' })
  @IsString()
  serviceId!: string;

  @ApiProperty({ example: '2026-05-30T15:00:00.000Z' })
  @IsDateString()
  startTime!: string;

  @ApiProperty({ example: 'Amina Johnson' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  customerName!: string;

  @ApiProperty({ example: '+15551234567' })
  @IsString()
  @MinLength(7)
  @MaxLength(32)
  phone!: string;

  @ApiPropertyOptional({ example: 'amina@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '123 Main St, Apt 4B' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;

  @ApiPropertyOptional({
    example: 'Deep clean, two bedrooms, customer has a small dog.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Create an invoice and checkout link immediately.',
  })
  @IsOptional()
  @IsBoolean()
  payNow?: boolean;
}
