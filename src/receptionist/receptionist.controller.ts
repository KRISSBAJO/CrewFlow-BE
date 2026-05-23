import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ConversationStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { HandoffConversationDto } from './dto/handoff-conversation.dto';
import { ReceptionistMessageDto } from './dto/receptionist-message.dto';
import { UpdateReceptionistConfigDto } from './dto/update-receptionist-config.dto';
import { ReceptionistService } from './receptionist.service';

@Controller('receptionist')
export class ReceptionistController {
  constructor(private readonly receptionist: ReceptionistService) {}

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('config')
  getConfig(@CurrentUser() user: AuthUser) {
    return this.receptionist.getConfig(user.tenantId);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Patch('config')
  updateConfig(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateReceptionistConfigDto,
  ) {
    return this.receptionist.updateConfig(user, dto);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('conversations')
  findConversations(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: ConversationStatus,
  ) {
    return this.receptionist.findConversations(user, status);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('conversations/:id')
  findConversation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.receptionist.findConversation(user, id);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('conversations/:id/handoff')
  handoff(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: HandoffConversationDto,
  ) {
    return this.receptionist.handoff(user, id, dto);
  }

  @Post('inquiry')
  handleInquiry(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReceptionistMessageDto,
  ) {
    return this.receptionist.handleInquiry(user.tenantId, dto);
  }
}
