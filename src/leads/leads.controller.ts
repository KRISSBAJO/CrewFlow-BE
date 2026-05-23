import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LeadStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadsService } from './leads.service';

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: LeadStatus,
    @Query('assignedToMe') assignedToMe?: string,
  ) {
    return this.leads.findAll(user, status, assignedToMe === 'true');
  }

  @Get('analytics')
  analytics(@CurrentUser() user: AuthUser) {
    return this.leads.analytics(user);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLeadDto) {
    return this.leads.create(user, dto);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leads.update(user, id, dto);
  }
}
