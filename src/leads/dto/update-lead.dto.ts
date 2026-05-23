import { PartialType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
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
import { CreateLeadDto } from './create-lead.dto';

export class UpdateLeadDto extends PartialType(CreateLeadDto) {
  @ApiPropertyOptional({ enum: LeadStatus, example: LeadStatus.QUALIFIED })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({ enum: LeadSource, example: LeadSource.REFERRAL })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional({ example: 'Booked for next Friday.' })
  @IsOptional()
  @IsString()
  wonLostReason?: string;

  @ApiPropertyOptional({ example: '2026-05-24T15:00:00.000Z', nullable: true })
  @IsOptional()
  @IsDateString()
  followUpAt?: string;

  @ApiPropertyOptional({ example: 80, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  conversionProbability?: number;
}
