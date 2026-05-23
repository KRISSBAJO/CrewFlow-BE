import { ApiProperty } from '@nestjs/swagger';
import { MessageProvider } from '@prisma/client';
import { IsEnum, IsString } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ example: 'clx_customer_id' })
  @IsString()
  customerId: string;

  @ApiProperty({ enum: MessageProvider, example: MessageProvider.WHATSAPP })
  @IsEnum(MessageProvider)
  provider: MessageProvider;

  @ApiProperty({
    example: 'Marcus is on the way and should arrive in about 20 minutes.',
  })
  @IsString()
  content: string;
}
