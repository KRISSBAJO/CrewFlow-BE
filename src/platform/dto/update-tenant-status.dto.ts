import { ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionStatus, TenantStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateTenantStatusDto {
  @ApiPropertyOptional({ enum: TenantStatus, example: TenantStatus.ACTIVE })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @ApiPropertyOptional({
    enum: SubscriptionStatus,
    example: SubscriptionStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  subscriptionStatus?: SubscriptionStatus;

  @ApiPropertyOptional({ example: 'growth' })
  @IsOptional()
  @IsString()
  subscriptionPlan?: string;

  @ApiPropertyOptional({ example: 'billing@example.com' })
  @IsOptional()
  @IsString()
  billingEmail?: string;

  @ApiPropertyOptional({ example: 49900 })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyPriceCents?: number;

  @ApiPropertyOptional({ example: 150000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  setupFeeCents?: number;

  @ApiPropertyOptional({ example: '2026-06-23T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  trialEndsAt?: string;

  @ApiPropertyOptional({ example: '2026-06-23T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  currentPeriodEnd?: string;

  @ApiPropertyOptional({ example: '2026-06-23T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  nextBillingAt?: string;

  @ApiPropertyOptional({ example: 'cus_123' })
  @IsOptional()
  @IsString()
  stripeCustomerId?: string;

  @ApiPropertyOptional({ example: 'sub_123' })
  @IsOptional()
  @IsString()
  stripeSubscriptionId?: string;

  @ApiPropertyOptional({ example: { aiReceptionist: true, retention: true } })
  @IsOptional()
  @IsObject()
  featureFlags?: Record<string, boolean>;

  @ApiPropertyOptional({ example: { staff: 25, monthlyBookings: 500 } })
  @IsOptional()
  @IsObject()
  planLimits?: Record<string, number>;
}
