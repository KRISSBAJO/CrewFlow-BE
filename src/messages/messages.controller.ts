import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { CreateMessageDto } from './dto/create-message.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesService } from './messages.service';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMessageDto) {
    return this.messages.create(user.tenantId, dto);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('send')
  send(@CurrentUser() user: AuthUser, @Body() dto: SendMessageDto) {
    return this.messages.send(user, dto);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('customerId') customerId?: string,
  ) {
    return this.messages.findAll(user.tenantId, customerId);
  }
}
