import { Body, Controller, Get, Post } from '@nestjs/common';
import { Query, Param } from '@nestjs/common';
import {
  AutomationRunStatus,
  AutomationTrigger,
  UserRole,
} from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { AutomationsService } from './automations.service';
import { RetryAutomationRunDto } from './dto/retry-automation-run.dto';
import { UpsertAutomationDto } from './dto/upsert-automation.dto';
import {
  LinkWhatsappTemplateDto,
  UpsertWhatsappTemplateDto,
} from './dto/upsert-whatsapp-template.dto';
import { WhatsappTemplatesService } from './whatsapp-templates.service';

@Controller('automations')
export class AutomationsController {
  constructor(
    private readonly automations: AutomationsService,
    private readonly whatsappTemplates: WhatsappTemplatesService,
  ) {}

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.automations.findAll(user.tenantId);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post()
  upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertAutomationDto) {
    return this.automations.upsert(user.tenantId, dto);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('whatsapp-templates')
  whatsappTemplateList(@CurrentUser() user: AuthUser) {
    return this.whatsappTemplates.list(user.tenantId);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('whatsapp-templates')
  upsertWhatsappTemplate(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertWhatsappTemplateDto,
  ) {
    return this.whatsappTemplates.upsert(user.tenantId, user.sub, dto);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('whatsapp-templates/defaults')
  seedWhatsappTemplateDefaults(@CurrentUser() user: AuthUser) {
    return this.whatsappTemplates.seedDefaults(user.tenantId, user.sub);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('whatsapp-templates/:id/submit')
  submitWhatsappTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.whatsappTemplates.submitToMeta(user.tenantId, user.sub, id);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('whatsapp-templates/:id/link')
  linkWhatsappTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: LinkWhatsappTemplateDto,
  ) {
    return this.whatsappTemplates.linkAutomation(
      user.tenantId,
      user.sub,
      id,
      dto.trigger,
    );
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('runs')
  findRuns(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: AutomationRunStatus,
    @Query('trigger') trigger?: AutomationTrigger,
  ) {
    return this.automations.findRuns(user.tenantId, status, trigger);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('workflow-check')
  verifyWorkflowPack(@CurrentUser() user: AuthUser) {
    return this.automations.verifyWorkflowPack(user.tenantId, user.sub);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('runs/:id/retry')
  retry(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RetryAutomationRunDto,
  ) {
    return this.automations.retry(user.tenantId, id, user.sub, dto.reason);
  }
}
