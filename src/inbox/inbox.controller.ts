import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ConversationStatus, MessageProvider, UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { CreateActionFromConversationDto } from './dto/create-action-from-conversation.dto';
import { CreateBookingIntentFromConversationDto } from './dto/create-booking-intent-from-conversation.dto';
import { ReplyConversationDto } from './dto/reply-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { InboxService } from './inbox.service';

@Roles(UserRole.OWNER, UserRole.MANAGER)
@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: ConversationStatus,
    @Query('assignedToMe') assignedToMe?: string,
    @Query('channel') channel?: MessageProvider,
  ) {
    return this.inbox.findAll(user, status, assignedToMe === 'true', channel);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inbox.findOne(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.inbox.update(user, id, dto);
  }

  @Post(':id/reply')
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReplyConversationDto,
  ) {
    return this.inbox.reply(user, id, dto);
  }

  @Post(':id/ai-suggest')
  suggestReply(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inbox.suggestReply(user, id);
  }

  @Post(':id/actions')
  createAction(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateActionFromConversationDto,
  ) {
    return this.inbox.createAction(user, id, dto);
  }

  @Post(':id/booking-intents')
  createBookingIntent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateBookingIntentFromConversationDto,
  ) {
    return this.inbox.createBookingIntent(user, id, dto);
  }
}
