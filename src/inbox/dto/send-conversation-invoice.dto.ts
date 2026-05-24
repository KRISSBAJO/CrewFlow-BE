import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class SendConversationInvoiceDto {
  @ApiProperty({ example: 'cm_invoice_id' })
  @IsString()
  invoiceId: string;

  @ApiPropertyOptional({ enum: PaymentProvider })
  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider;

  @ApiPropertyOptional({ example: 'Here is your payment link.' })
  @IsOptional()
  @IsString()
  note?: string;
}
