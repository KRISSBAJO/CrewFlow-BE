import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingEventType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateBillingEventDto {
  @ApiProperty({
    enum: BillingEventType,
    example: BillingEventType.SUBSCRIPTION_RENEWED,
  })
  @IsEnum(BillingEventType)
  type: BillingEventType;

  @ApiPropertyOptional({ example: 29900 })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @ApiPropertyOptional({ example: 'manual' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ example: 'Invoice paid outside Stripe.' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ example: { invoiceNo: 'INV-1001' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
