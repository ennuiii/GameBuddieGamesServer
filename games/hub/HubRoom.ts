import { Room, Client } from '@colyseus/core';
import { Player, HubState, ChatMessage, Conversation } from './schema/HubState.js';
import { Message } from './Message.js';

const MAX_CONVERSATION_SIZE = 6; // P2P mesh limit

export interface HubRoomOptions {
  roomCode?: string;
  playerName?: string;
}

/**
 * HubRoom - Colyseus room for the 2D virtual world
 *
 * Handles player positions, animations, and chat messages.
 * Works alongside Socket.IO (which handles room management and WebRTC).
 */
export class HubRoom extends Room<HubState> {
  private roomCode: string = '';

  // Helper: Generate unique conversation ID
  private generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Helper: Get all participants in a conversation
  private getConversationParticipants(conversationId: string): string[] {
    const participants: string[] = [];
    this.state.players.forEach((player, sessionId) => {
      if (player.conversationId === conversationId) {
        participants.push(sessionId);
      }
    });
    return participants;
  }

  // Helper: Notify all participants in a conversation
  private notifyConversationUpdate(conversationId: string) {
    const participants = this.getConversationParticipants(conversationId);
    const conversation = this.state.conversations.get(conversationId);

    participants.forEach((sessionId) => {
      const client = this.clients.find((c) => c.sessionId === sessionId);
      if (client && conversation) {
        client.send(Message.CONVERSATION_UPDATED, {
          conversationId,
          hostId: conversation.hostId,
          locked: conversation.locked,
          participants,
        });
      }
    });
  }

  onCreate(options: HubRoomOptions) {
    this.roomCode = options.roomCode || this.roomId;
    this.autoDispose = false; // Keep room alive for reconnections

    this.setMetadata({ roomCode: this.roomCode });
    this.setState(new HubState());

    // Handle player position/animation updates
    this.onMessage(Message.UPDATE_PLAYER, (client, message: { x: number; y: number; anim: string }) => {
      const player = this.state.players.get(client.sessionId);

      if (!player) return;

      // Validate payload before updating
      if (typeof message.x === 'number' && typeof message.y === 'number' && typeof message.anim === 'string') {
        player.x = message.x;
        player.y = message.y;
        player.anim = message.anim;
      }
    });

    // Handle player name updates
    this.onMessage(Message.UPDATE_PLAYER_NAME, (client, message: { name: string }) => {
      const player = this.state.players.get(client.sessionId);

      if (!player) return;

      if (typeof message.name === 'string' && message.name.trim().length > 0) {
        player.name = message.name.trim().substring(0, 20); // Limit name length
      }
    });

    // Handle chat messages
    this.onMessage(Message.ADD_CHAT_MESSAGE, (client, message: { content: string }) => {
      const player = this.state.players.get(client.sessionId);

      if (!player || !message.content) return;

      const chatMessage = new ChatMessage();
      chatMessage.author = player.name || client.sessionId;
      chatMessage.authorId = client.sessionId; // For correct bubble placement
      chatMessage.content = message.content.substring(0, 500); // Limit message length
      chatMessage.createdAt = Date.now();

      this.state.chatMessages.push(chatMessage);

      // Keep only last 100 messages
      if (this.state.chatMessages.length > 100) {
        this.state.chatMessages.shift();
      }
    });

    // ========== CONVERSATION HANDLERS ==========

    // START_CONVERSATION - Player A initiates conversation with Player B
    this.onMessage(Message.START_CONVERSATION, (client, message: { targetSessionId: string }) => {
      const initiator = this.state.players.get(client.sessionId);
      const target = this.state.players.get(message.targetSessionId);

      if (!initiator || !target) {
        console.log(`[Hub] START_CONVERSATION failed: player not found`);
        return;
      }

      // Check neither player is already in a conversation
      if (initiator.conversationId) {
        console.log(`[Hub] START_CONVERSATION failed: initiator already in conversation`);
        return;
      }
      if (target.conversationId) {
        console.log(`[Hub] START_CONVERSATION failed: target already in conversation`);
        return;
      }

      // Create new conversation
      const conversationId = this.generateConversationId();
      const conversation = new Conversation();
      conversation.id = conversationId;
      conversation.hostId = client.sessionId; // Initiator is host
      conversation.locked = false;

      this.state.conversations.set(conversationId, conversation);

      // Add both players to conversation
      initiator.conversationId = conversationId;
      target.conversationId = conversationId;

      console.log(`[Hub] Conversation ${conversationId} started between ${client.sessionId} and ${message.targetSessionId}`);

      // Notify both players
      this.notifyConversationUpdate(conversationId);
    });

    // LEAVE_CONVERSATION - Player leaves their current conversation
    this.onMessage(Message.LEAVE_CONVERSATION, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.conversationId) return;

      const conversationId = player.conversationId;
      const conversation = this.state.conversations.get(conversationId);
      if (!conversation) return;

      // Clear player's conversation
      player.conversationId = '';

      // Get remaining participants
      const remaining = this.getConversationParticipants(conversationId);

      if (remaining.length <= 1) {
        // Only 1 or 0 players left - delete conversation
        if (remaining.length === 1) {
          const lastPlayer = this.state.players.get(remaining[0]);
          if (lastPlayer) {
            lastPlayer.conversationId = '';
            // Notify last player they're no longer in conversation
            const lastClient = this.clients.find((c) => c.sessionId === remaining[0]);
            if (lastClient) {
              lastClient.send(Message.CONVERSATION_UPDATED, {
                conversationId: null,
                hostId: null,
                locked: false,
                participants: [],
              });
            }
          }
        }
        this.state.conversations.delete(conversationId);
        console.log(`[Hub] Conversation ${conversationId} deleted (no participants)`);
      } else {
        // Transfer host if needed
        if (conversation.hostId === client.sessionId) {
          conversation.hostId = remaining[0];
          console.log(`[Hub] Host transferred to ${remaining[0]} in conversation ${conversationId}`);
        }
        // Notify remaining participants
        this.notifyConversationUpdate(conversationId);
      }

      console.log(`[Hub] Player ${client.sessionId} left conversation ${conversationId}`);
    });

    // REQUEST_JOIN - Player requests to join an existing conversation
    this.onMessage(Message.REQUEST_JOIN, (client, message: { conversationId: string }) => {
      const player = this.state.players.get(client.sessionId);
      const conversation = this.state.conversations.get(message.conversationId);

      if (!player || !conversation) return;
      if (player.conversationId) return; // Already in a conversation

      const participants = this.getConversationParticipants(message.conversationId);
      if (participants.length >= MAX_CONVERSATION_SIZE) {
        console.log(`[Hub] REQUEST_JOIN failed: conversation full`);
        client.send(Message.JOIN_DENIED, { conversationId: message.conversationId, reason: 'full' });
        return;
      }

      if (!conversation.locked) {
        // Auto-approve: add player immediately
        player.conversationId = message.conversationId;
        console.log(`[Hub] Player ${client.sessionId} auto-joined conversation ${message.conversationId}`);
        this.notifyConversationUpdate(message.conversationId);
      } else {
        // Locked: send request to host
        const hostClient = this.clients.find((c) => c.sessionId === conversation.hostId);
        if (hostClient) {
          hostClient.send(Message.JOIN_REQUESTED, {
            conversationId: message.conversationId,
            requesterId: client.sessionId,
            requesterName: player.name || client.sessionId,
          });
          console.log(`[Hub] Join request sent to host ${conversation.hostId} for conversation ${message.conversationId}`);
        }
      }
    });

    // APPROVE_JOIN - Host approves a join request
    this.onMessage(Message.APPROVE_JOIN, (client, message: { conversationId: string; requesterId: string }) => {
      const conversation = this.state.conversations.get(message.conversationId);
      if (!conversation || conversation.hostId !== client.sessionId) return; // Must be host

      const requester = this.state.players.get(message.requesterId);
      if (!requester || requester.conversationId) return; // Requester gone or already in conversation

      const participants = this.getConversationParticipants(message.conversationId);
      if (participants.length >= MAX_CONVERSATION_SIZE) {
        const requesterClient = this.clients.find((c) => c.sessionId === message.requesterId);
        if (requesterClient) {
          requesterClient.send(Message.JOIN_DENIED, { conversationId: message.conversationId, reason: 'full' });
        }
        return;
      }

      // Add requester to conversation
      requester.conversationId = message.conversationId;
      console.log(`[Hub] Player ${message.requesterId} approved to join conversation ${message.conversationId}`);
      this.notifyConversationUpdate(message.conversationId);
    });

    // DENY_JOIN - Host denies a join request
    this.onMessage(Message.DENY_JOIN, (client, message: { conversationId: string; requesterId: string }) => {
      const conversation = this.state.conversations.get(message.conversationId);
      if (!conversation || conversation.hostId !== client.sessionId) return; // Must be host

      const requesterClient = this.clients.find((c) => c.sessionId === message.requesterId);
      if (requesterClient) {
        requesterClient.send(Message.JOIN_DENIED, { conversationId: message.conversationId, reason: 'denied' });
        console.log(`[Hub] Join request denied for ${message.requesterId} to conversation ${message.conversationId}`);
      }
    });

    // LOCK_CONVERSATION - Host toggles conversation lock
    this.onMessage(Message.LOCK_CONVERSATION, (client, message: { conversationId: string; locked: boolean }) => {
      const conversation = this.state.conversations.get(message.conversationId);
      if (!conversation || conversation.hostId !== client.sessionId) return; // Must be host

      conversation.locked = message.locked;
      console.log(`[Hub] Conversation ${message.conversationId} locked: ${message.locked}`);
      this.notifyConversationUpdate(message.conversationId);
    });

    console.log(`[Hub] Room "${this.roomCode}" created (Colyseus ID: ${this.roomId})`);
  }

  onJoin(client: Client, options: HubRoomOptions) {
    console.log(`[Hub] Player ${client.sessionId} joined room ${this.roomCode}`);

    const player = new Player();
    player.name = options.playerName || '';
    player.x = 400 + Math.random() * 100 - 50; // Spawn near center with slight randomness
    player.y = 300 + Math.random() * 100 - 50;
    player.anim = 'idle_down';

    console.log(`[Hub] Creating player:`, { name: player.name, x: player.x, y: player.y, anim: player.anim });
    console.log(`[Hub] State players before set:`, this.state.players.size);

    this.state.players.set(client.sessionId, player);

    console.log(`[Hub] State players after set:`, this.state.players.size);
    console.log(`[Hub] Player added to state. All players:`, Array.from(this.state.players.keys()));

    // Send room data to the joining player
    client.send(Message.SEND_ROOM_DATA, {
      id: this.roomId,
      roomCode: this.roomCode,
    });
  }

  async onLeave(client: Client, consented: boolean) {
    console.log(`[Hub] Player ${client.sessionId} left room ${this.roomCode} (consented: ${consented})`);

    if (!consented) {
      // Player disconnected unexpectedly - allow reconnection
      try {
        await this.allowReconnection(client, 60); // 60 seconds to reconnect
        console.log(`[Hub] Player ${client.sessionId} reconnected to room ${this.roomCode}`);
        return;
      } catch {
        // Reconnection timeout - remove player
        console.log(`[Hub] Player ${client.sessionId} reconnection timeout`);
      }
    }

    // Clean up conversation before removing player
    const player = this.state.players.get(client.sessionId);
    if (player?.conversationId) {
      const conversationId = player.conversationId;
      const conversation = this.state.conversations.get(conversationId);

      player.conversationId = '';
      const remaining = this.getConversationParticipants(conversationId);

      if (remaining.length <= 1) {
        // Delete conversation if 0-1 participants left
        if (remaining.length === 1) {
          const lastPlayer = this.state.players.get(remaining[0]);
          if (lastPlayer) {
            lastPlayer.conversationId = '';
            const lastClient = this.clients.find((c) => c.sessionId === remaining[0]);
            if (lastClient) {
              lastClient.send(Message.CONVERSATION_UPDATED, {
                conversationId: null,
                hostId: null,
                locked: false,
                participants: [],
              });
            }
          }
        }
        this.state.conversations.delete(conversationId);
        console.log(`[Hub] Conversation ${conversationId} deleted (player left)`);
      } else if (conversation) {
        // Transfer host if needed
        if (conversation.hostId === client.sessionId) {
          conversation.hostId = remaining[0];
        }
        this.notifyConversationUpdate(conversationId);
      }
    }

    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log(`[Hub] Room ${this.roomCode} disposing...`);
  }
}
