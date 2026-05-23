import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  Min,
} from 'class-validator';

export class CreateInvoiceLineItemDto {
  @ApiProperty({ example: 'Deep Home Cleaning' })
  @IsString()
  description: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({
    example: 249,
    minimum: 0,
    description: 'Display amount in dollars. Stored internally as cents.',
  })
  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class CreateInvoiceDto {
  @ApiProperty({ example: 'clx_customer_id' })
  @IsString()
  customerId: string;

  @ApiPropertyOptional({ example: 'clx_booking_id' })
  @IsOptional()
  @IsString()
  bookingId?: string;

  @ApiProperty({ example: 249, minimum: 0 })
  @IsNumber()
  @Min(0)
  subtotal: number;

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tax?: number;

  @ApiPropertyOptional({ type: [CreateInvoiceLineItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceLineItemDto)
  lineItems?: CreateInvoiceLineItemDto[];

  @ApiProperty({ example: '2026-05-30T23:59:59.000Z' })
  @IsDateString()
  dueDate: string;
}
