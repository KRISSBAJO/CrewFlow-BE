import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
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
