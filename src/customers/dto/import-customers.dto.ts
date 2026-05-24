import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ImportCustomerRowDto {
  @ApiProperty({ example: 'Nia Carter' })
  @IsString()
  name: string;

  @ApiProperty({ example: '+15550102020' })
  @IsString()
  phone: string;

  @ApiProperty({ example: 'nia@example.com', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    example: 'Recurring customer. Use side entrance.',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ImportCustomersDto {
  @ApiProperty({ type: [ImportCustomerRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportCustomerRowDto)
  customers: ImportCustomerRowDto[];
}

export class ImportWhatsAppCustomersDto {
  @ApiProperty({
    example:
      '5/24/26, 9:15 AM - +15550102020: Hi, I need a deep clean next Friday.',
  })
  @IsString()
  text: string;

  @ApiProperty({
    example: true,
    required: false,
    description:
      'Create lead records when imported messages look like booking inquiries.',
  })
  @IsOptional()
  @IsBoolean()
  createLeads?: boolean;
}
