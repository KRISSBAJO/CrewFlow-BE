import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageProvider } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum BookingUpdateType {
  CONFIRM_APPOINTMENT = 'CONFIRM_APPOINTMENT',
  CREW_ASSIGNED = 'CREW_ASSIGNED',
  ON_THE_WAY = 'ON_THE_WAY',
  RUNNING_LATE = 'RUNNING_LATE',
  INVOICE_READY = 'INVOICE_READY',
  REVIEW_REQUEST = 'REVIEW_REQUEST',
}

export class SendBookingUpdateDto {
  @ApiProperty({ enum: BookingUpdateType })
  @IsEnum(BookingUpdateType)
  type!: BookingUpdateType;

  @ApiPropertyOptional({
    enum: MessageProvider,
    example: MessageProvider.WHATSAPP,
  })
  @IsOptional()
  @IsEnum(MessageProvider)
  provider?: MessageProvider;

  @ApiPropertyOptional({ example: 'Crew should arrive about 15 minutes late.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
