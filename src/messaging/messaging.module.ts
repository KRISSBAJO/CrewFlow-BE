import { Module } from '@nestjs/common';
import { MessageProviderService } from './message-provider.service';

@Module({
  providers: [MessageProviderService],
  exports: [MessageProviderService],
})
export class MessagingModule {}
