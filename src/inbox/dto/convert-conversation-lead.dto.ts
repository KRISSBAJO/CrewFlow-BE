import { ApiPropertyOptional } from '@nestjs/swagger';
import { LeadStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ConvertConversationLeadDto {
  @ApiPropertyOptional({ example: 'Move-out cleaning inquiry' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ enum: LeadStatus, example: LeadStatus.QUALIFIED })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({ example: 24900 })
  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedValueCents?: number;

  @ApiPropertyOptional({ example: 70 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  conversionProbability?: number;

  @ApiPropertyOptional({ example: '2026-05-25T15:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  followUpAt?: string;

  @ApiPropertyOptional({ example: 'Asked for Friday afternoon.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
