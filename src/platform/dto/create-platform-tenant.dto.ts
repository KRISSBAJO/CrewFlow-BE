import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionStatus, TenantStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePlatformTenantDto {
  @ApiProperty({ example: 'Elite Home Services' })
  @IsString()
  businessName: string;

  @ApiProperty({ example: 'Cleaning + Home Services' })
  @IsString()
  industry: string;

  @ApiProperty({ example: 'Jordan Smith' })
  @IsString()
  ownerName: string;

  @ApiProperty({ example: 'owner@elite.test' })
  @IsEmail()
  ownerEmail: string;

  @ApiProperty({ example: 'Password123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  ownerPassword: string;

  @ApiPropertyOptional({ example: '+15550109999' })
  @IsOptional()
  @IsString()
  ownerPhone?: string;

  @ApiPropertyOptional({ example: 'elite-home-services' })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional({ enum: TenantStatus, example: TenantStatus.TRIAL })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @ApiPropertyOptional({
    enum: SubscriptionStatus,
    example: SubscriptionStatus.TRIALING,
  })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  subscriptionStatus?: SubscriptionStatus;

  @ApiPropertyOptional({ example: 'pilot' })
  @IsOptional()
  @IsString()
  subscriptionPlan?: string;

  @ApiPropertyOptional({ example: 'plan_growth' })
  @IsOptional()
  @IsString()
  subscriptionPlanId?: string;

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

  @ApiPropertyOptional({ example: { aiReceptionist: true, retention: true } })
  @IsOptional()
  @IsObject()
  featureFlags?: Record<string, boolean>;

  @ApiPropertyOptional({ example: { staff: 10, monthlyBookings: 200 } })
  @IsOptional()
  @IsObject()
  planLimits?: Record<string, number>;
}
