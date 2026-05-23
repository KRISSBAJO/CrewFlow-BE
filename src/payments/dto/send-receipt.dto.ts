import { ApiPropertyOptional } from '@nestjs/swagger';
import { MessageProvider } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class SendReceiptDto {
  @ApiPropertyOptional({
    enum: MessageProvider,
    example: MessageProvider.WHATSAPP,
  })
  @IsOptional()
  @IsEnum(MessageProvider)
  provider?: MessageProvider;

  @ApiPropertyOptional({
    example: 'Thank you for choosing Sparkle Home Services.',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
