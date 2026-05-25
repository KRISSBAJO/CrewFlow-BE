import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpsertSubscriptionPlanDto {
  @ApiPropertyOptional({ example: 'Growth' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'growth' })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional({ example: 'For active service teams.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 29900 })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyPriceCents?: number;

  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  setupFeeCents?: number;

  @ApiPropertyOptional({ example: 'price_123' })
  @IsOptional()
  @IsString()
  stripePriceId?: string;

  @ApiPropertyOptional({ example: 'PLN_123' })
  @IsOptional()
  @IsString()
  paystackPlanCode?: string;

  @ApiPropertyOptional({ example: { aiReceptionist: true } })
  @IsOptional()
  @IsObject()
  featureFlags?: Record<string, boolean>;

  @ApiPropertyOptional({ example: { staff: 25, monthlyBookings: 500 } })
  @IsOptional()
  @IsObject()
  planLimits?: Record<string, number>;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
