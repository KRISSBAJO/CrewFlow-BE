import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateTenantSettingsDto {
  @ApiPropertyOptional({ example: 'Sparkle Home Services' })
  @IsOptional()
  @IsString()
  businessName?: string;

  @ApiPropertyOptional({ example: 'Cleaning' })
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/demo/image/upload/tenants/sparkle-logo.png',
  })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/demo/image/upload/tenants/sparkle-cover.jpg',
  })
  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @ApiPropertyOptional({ example: '#0f766e' })
  @IsOptional()
  @IsString()
  brandColor?: string;

  @ApiPropertyOptional({ example: '+15551234567' })
  @IsOptional()
  @IsString()
  whatsappNumber?: string;

  @ApiPropertyOptional({ example: 'Austin metro area' })
  @IsOptional()
  @IsString()
  serviceArea?: string;

  @ApiPropertyOptional({
    example: {
      monday: '8:00 AM - 5:00 PM',
      tuesday: '8:00 AM - 5:00 PM',
    },
  })
  @IsOptional()
  @IsObject()
  businessHours?: Record<string, string>;

  @ApiPropertyOptional({ example: 'Missed inquiries and unpaid invoices' })
  @IsOptional()
  @IsString()
  biggestProblem?: string;

  @ApiPropertyOptional({ example: '3-10' })
  @IsOptional()
  @IsString()
  staffCount?: string;

  @ApiPropertyOptional({
    example: ['servicesReviewed', 'staffReviewed', 'whatsappPlanned'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  completedSteps?: string[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  whatsappPlanned?: boolean;
}
