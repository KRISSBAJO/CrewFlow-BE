import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageDirection, MessageProvider } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateMessageDto {
  @ApiPropertyOptional({ example: 'clx_customer_id' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiProperty({ enum: MessageDirection, example: MessageDirection.OUTBOUND })
  @IsEnum(MessageDirection)
  direction: MessageDirection;

  @ApiProperty({ enum: MessageProvider, example: MessageProvider.WHATSAPP })
  @IsEnum(MessageProvider)
  provider: MessageProvider;

  @ApiProperty({
    example: 'Marcus is on the way and should arrive in about 20 minutes.',
  })
  @IsString()
  content: string;
}
