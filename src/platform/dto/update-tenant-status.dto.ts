import { ApiPropertyOptional } from '@nestjs/swagger';
import { TenantStatus } from '@prisma/client';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class UpdateTenantStatusDto {
  @ApiPropertyOptional({ enum: TenantStatus, example: TenantStatus.ACTIVE })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

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

  @ApiPropertyOptional({ example: { aiReceptionist: true, retention: true } })
  @IsOptional()
  @IsObject()
  featureFlags?: Record<string, boolean>;

  @ApiPropertyOptional({ example: { staff: 25, monthlyBookings: 500 } })
  @IsOptional()
  @IsObject()
  planLimits?: Record<string, number>;
}
