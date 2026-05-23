import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { CompleteJobDto } from './dto/complete-job.dto';
import { JobNoteDto } from './dto/job-note.dto';
import { FieldOpsService } from './field-ops.service';

@Controller('field')
export class FieldOpsController {
  constructor(private readonly fieldOps: FieldOpsService) {}

  @Get('jobs')
  jobs(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    return this.fieldOps.jobs(user, date);
  }

  @Get('jobs/:bookingId')
  job(@CurrentUser() user: AuthUser, @Param('bookingId') bookingId: string) {
    return this.fieldOps.job(user, bookingId);
  }

  @Post('jobs/:bookingId/start')
  startJob(
    @CurrentUser() user: AuthUser,
    @Param('bookingId') bookingId: string,
  ) {
    return this.fieldOps.startJob(user, bookingId);
  }

  @Post('jobs/:bookingId/notes')
  saveNotes(
    @CurrentUser() user: AuthUser,
    @Param('bookingId') bookingId: string,
    @Body() dto: JobNoteDto,
  ) {
    return this.fieldOps.saveNotes(user, bookingId, dto);
  }

  @Post('jobs/:bookingId/complete')
  completeJob(
    @CurrentUser() user: AuthUser,
    @Param('bookingId') bookingId: string,
    @Body() dto: CompleteJobDto,
  ) {
    return this.fieldOps.completeJob(user, bookingId, dto);
  }

  @Get('jobs/:bookingId/report')
  report(@CurrentUser() user: AuthUser, @Param('bookingId') bookingId: string) {
    return this.fieldOps.report(user, bookingId);
  }
}
