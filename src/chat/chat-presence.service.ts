import { Injectable } from '@nestjs/common';

@Injectable()
export class ChatPresenceService {
  private readonly socketsByUser = new Map<number, Set<string>>();
  private readonly userBySocket = new Map<string, number>();

  addConnection(userId: number, socketId: string) {
    const sockets = this.socketsByUser.get(userId) ?? new Set<string>();
    sockets.add(socketId);
    this.socketsByUser.set(userId, sockets);
    this.userBySocket.set(socketId, userId);
  }

  removeConnection(socketId: string) {
    const userId = this.userBySocket.get(socketId);
    if (userId === undefined) {
      return;
    }

    const sockets = this.socketsByUser.get(userId);
    if (!sockets) {
      this.userBySocket.delete(socketId);
      return;
    }

    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.socketsByUser.delete(userId);
    }
    this.userBySocket.delete(socketId);
  }

  isOnline(userId: number) {
    return (this.socketsByUser.get(userId)?.size ?? 0) > 0;
  }
}
