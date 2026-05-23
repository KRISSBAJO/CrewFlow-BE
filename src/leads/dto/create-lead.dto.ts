import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadSource, LeadStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateLeadDto {
  @ApiProperty({ example: 'Move-out deep clean for Jordan Ellis' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ enum: LeadStatus, example: LeadStatus.NEW })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({ enum: LeadSource, example: LeadSource.WEB_CHAT })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional({ example: 'clx_customer_id' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ example: 'clx_conversation_id' })
  @IsOptional()
  @IsString()
  conversationId?: string;

  @ApiPropertyOptional({ example: 'clx_staff_id' })
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @ApiPropertyOptional({
    example: 24900,
    description: 'Estimated deal value in cents.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedValueCents?: number;

  @ApiPropertyOptional({ example: 65, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  conversionProbability?: number;

  @ApiPropertyOptional({ example: '2026-05-24T15:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  followUpAt?: string;

  @ApiPropertyOptional({ example: 'Customer needs Friday afternoon.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
