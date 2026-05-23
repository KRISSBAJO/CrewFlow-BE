import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ActionPriority,
  ActionStatus,
  ActionType,
  UserRole,
} from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { UpdateActionDto } from './dto/update-action.dto';
import { WorkflowsService } from './workflows.service';

@Controller()
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get('actions')
  findActions(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: ActionStatus,
    @Query('priority') priority?: ActionPriority,
    @Query('type') type?: ActionType,
  ) {
    return this.workflows.findActions(user, status, priority, type);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Patch('actions/:id')
  updateAction(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateActionDto,
  ) {
    return this.workflows.updateAction(user, id, dto);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('workflows/scan-overdue-invoices')
  scanOverdueInvoices(@CurrentUser() user: AuthUser) {
    return this.workflows.scanOverdueInvoices(user);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('workflows/scan-lost-revenue')
  scanLostRevenueRisk(@CurrentUser() user: AuthUser) {
    return this.workflows.scanLostRevenueRisk(user);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('workflows/scan-lead-follow-ups')
  scanLeadFollowUps(@CurrentUser() user: AuthUser) {
    return this.workflows.scanLeadFollowUps(user);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('workflows/scan-billing-recovery')
  scanBillingRecovery(@CurrentUser() user: AuthUser) {
    return this.workflows.scanBillingRecovery(user);
  }
}
