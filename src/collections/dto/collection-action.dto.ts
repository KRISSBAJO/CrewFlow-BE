import { ApiPropertyOptional } from '@nestjs/swagger';
import { MessageProvider } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum CollectionActionType {
  SEND_PAYMENT_LINK = 'SEND_PAYMENT_LINK',
  SEND_REMINDER = 'SEND_REMINDER',
  MARK_PAID = 'MARK_PAID',
  VOID_INVOICE = 'VOID_INVOICE',
  PROMISE_TO_PAY = 'PROMISE_TO_PAY',
}

export class CollectionActionDto {
  @ApiPropertyOptional({ enum: CollectionActionType })
  @IsEnum(CollectionActionType)
  type!: CollectionActionType;

  @ApiPropertyOptional({
    enum: MessageProvider,
    example: MessageProvider.WHATSAPP,
  })
  @IsOptional()
  @IsEnum(MessageProvider)
  provider?: MessageProvider;

  @ApiPropertyOptional({
    example: 'Customer said payment will be sent by Friday.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ example: '2026-05-29T17:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  promiseDate?: string;
}
