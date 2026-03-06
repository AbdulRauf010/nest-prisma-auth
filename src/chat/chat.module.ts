import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatGateway } from './chat.gateway';
import { ChatPresenceService } from './chat-presence.service';

@Module({
  imports: [AuthModule],
  providers: [ChatGateway, ChatPresenceService],
})
export class ChatModule {}
