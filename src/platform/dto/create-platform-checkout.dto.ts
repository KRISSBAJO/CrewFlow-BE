import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreatePlatformCheckoutDto {
  @ApiPropertyOptional({
    example: 'paystack',
    enum: ['stripe', 'paystack', 'mock'],
  })
  @IsOptional()
  @IsIn(['stripe', 'paystack', 'mock'])
  provider?: 'stripe' | 'paystack' | 'mock';

  @ApiPropertyOptional({ example: 'usd' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 'PLN_xxxxxxxxxx' })
  @IsOptional()
  @IsString()
  paystackPlanCode?: string;

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

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  collectSetupFee?: boolean;

  @ApiPropertyOptional({
    example: 'https://app.crewflow.ai/admin?billing=success',
  })
  @IsOptional()
  @IsString()
  successUrl?: string;

  @ApiPropertyOptional({
    example: 'https://app.crewflow.ai/admin?billing=cancel',
  })
  @IsOptional()
  @IsString()
  cancelUrl?: string;
}
