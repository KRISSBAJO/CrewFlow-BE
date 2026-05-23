import { Controller, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/roles.decorator';
import { OperationsSchedulerService } from './operations-scheduler.service';

@Roles(UserRole.OWNER, UserRole.MANAGER)
@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly scheduler: OperationsSchedulerService) {}

  @Post('run-now')
  runNow() {
    return this.scheduler.runAllTenants('manual-api');
  }
}
