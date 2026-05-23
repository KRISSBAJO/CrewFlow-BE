import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class JobNoteDto {
  @ApiPropertyOptional({
    example: 'Customer asked for extra attention to bathrooms.',
  })
  @IsOptional()
  @IsString()
  staffNotes?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://cdn.example.com/jobs/photo-1.jpg'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];
}
