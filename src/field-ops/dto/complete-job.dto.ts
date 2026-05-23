import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CompleteJobChecklistItemDto {
  @ApiProperty({ example: 'Kitchen cleaned' })
  @IsString()
  label: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  done: boolean;

  @ApiPropertyOptional({ example: 'Inside oven excluded by customer.' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class CompleteJobDto {
  @ApiPropertyOptional({ type: [CompleteJobChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompleteJobChecklistItemDto)
  checklist?: CompleteJobChecklistItemDto[];

  @ApiPropertyOptional({
    type: [String],
    example: ['https://cdn.example.com/jobs/after-kitchen.jpg'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];

  @ApiPropertyOptional({
    example: 'Job completed. Customer wants monthly cleaning.',
  })
  @IsOptional()
  @IsString()
  staffNotes?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/signatures/maya.png',
  })
  @IsOptional()
  @IsString()
  customerSignatureUrl?: string;

  @ApiPropertyOptional({ example: 'Maya Stone' })
  @IsOptional()
  @IsString()
  customerSignatureName?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Creates a SENT invoice from the completed booking when none exists.',
  })
  @IsOptional()
  @IsBoolean()
  autoInvoice?: boolean;
}
