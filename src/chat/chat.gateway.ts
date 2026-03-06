import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatPresenceService } from './chat-presence.service';
import { SendDirectMessageDto } from './dto/send-direct-message.dto';

type JwtPayload = {
  sub: number;
  email: string;
};

@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: '*' },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly presence: ChatPresenceService,
  ) {}

  async handleConnection(client: Socket) {
    const token = this.extractToken(client);
    this.logger.debug(
      `Incoming socket connection id=${client.id} hasToken=${Boolean(token)}`,
    );
    if (!token) {
      this.logger.warn(`Disconnecting socket id=${client.id}: missing token`);
      client.emit('chat:error', { message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      if (!payload?.sub) {
        throw new Error('Invalid token');
      }

      client.data.user = { userId: payload.sub, email: payload.email };
      this.presence.addConnection(payload.sub, client.id);
      client.join(this.userRoom(payload.sub));
      this.logger.log(
        `Socket connected id=${client.id} userId=${payload.sub} email=${payload.email}`,
      );
      client.emit('chat:connected', { userId: payload.sub });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `Disconnecting socket id=${client.id}: token verification failed (${reason})`,
      );
      client.emit('chat:error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId: number | undefined = client.data.user?.userId;
    this.presence.removeConnection(client.id);
    this.logger.log(`Socket disconnected id=${client.id} userId=${userId}`);
  }

  @SubscribeMessage('chat:send')
  handleDirectMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendDirectMessageDto,
  ) {
    const fromUserId: number | undefined = client.data.user?.userId;
    if (!fromUserId) {
      this.logger.warn(`chat:send rejected for socket id=${client.id}: no user`);
      throw new WsException('Unauthorized');
    }

    const toUserId = Number(payload?.toUserId);
    const content = String(payload?.content ?? '').trim();

    if (!Number.isInteger(toUserId) || toUserId <= 0) {
      this.logger.warn(
        `chat:send rejected from userId=${fromUserId}: invalid toUserId=${payload?.toUserId}`,
      );
      throw new WsException('toUserId must be a positive integer');
    }
    if (!content) {
      this.logger.warn(
        `chat:send rejected from userId=${fromUserId}: empty content`,
      );
      throw new WsException('content is required');
    }

    const message = {
      id: randomUUID(),
      fromUserId,
      toUserId,
      content,
      sentAt: new Date().toISOString(),
    };

    this.server.to(this.userRoom(toUserId)).emit('chat:message', message);
    client.emit('chat:message', message);
    const deliveryStatus = this.presence.isOnline(toUserId)
      ? 'delivered'
      : 'offline';
    client.emit('chat:delivery', {
      messageId: message.id,
      status: deliveryStatus,
    });
    this.logger.log(
      `chat:send from=${fromUserId} to=${toUserId} messageId=${message.id} status=${deliveryStatus}`,
    );

    return { ok: true, messageId: message.id };
  }

  @SubscribeMessage('chat:whoami')
  handleWhoAmI(@ConnectedSocket() client: Socket) {
    const user = client.data.user;
    if (!user?.userId) {
      throw new WsException('Unauthorized');
    }
    return user;
  }

  private extractToken(client: Socket) {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim().length > 0) {
      this.logger.debug('Token source=handshake.auth.token');
      return authToken.trim();
    }

    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.trim().length > 0) {
      const normalized = header.trim();

      // Accept both "Bearer <token>" and raw "<token>" for Postman compatibility.
      const [type, token] = normalized.split(' ');
      if (type?.toLowerCase() === 'bearer' && token) {
        this.logger.debug('Token source=authorization bearer header');
        return token.trim();
      }
      this.logger.debug('Token source=authorization raw header');
      return normalized;
    }

    const queryToken = client.handshake.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim().length > 0) {
      this.logger.debug('Token source=query token');
      return queryToken.trim();
    }

    this.logger.debug('Token source=none');
    return null;
  }

  private userRoom(userId: number) {
    return `user:${userId}`;
  }
}
