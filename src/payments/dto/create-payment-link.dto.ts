import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class CreatePaymentLinkDto {
  @ApiPropertyOptional({
    enum: PaymentProvider,
    example: PaymentProvider.STRIPE,
    description:
      'Defaults to STRIPE when STRIPE_SECRET_KEY exists, otherwise MOCK for local demos.',
  })
  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider;
}
