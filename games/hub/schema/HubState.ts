import { Schema, ArraySchema, MapSchema, defineTypes } from '@colyseus/schema';

/**
 * Player schema for Hub 2D world
 *
 * Using defineTypes() + constructor pattern because:
 * 1. TSX/esbuild doesn't fully support TypeScript decorators at runtime
 * 2. Constructor pattern required with useDefineForClassFields: false
 *
 * This matches RetroArcade's working implementation.
 */
export class Player extends Schema {
  name: string;
  x: number;
  y: number;
  anim: string;
  conversationId: string; // Empty = not in conversation, non-empty = ID of conversation

  constructor() {
    super();
    this.name = '';
    this.x = 400;
    this.y = 300;
    this.anim = 'idle_down';
    this.conversationId = '';
  }
}

// Define types at runtime (works with esbuild/tsx)
defineTypes(Player, {
  name: 'string',
  x: 'number',
  y: 'number',
  anim: 'string',
  conversationId: 'string',
});

/**
 * Chat message schema
 */
export class ChatMessage extends Schema {
  author: string;
  createdAt: number;
  content: string;

  constructor() {
    super();
    this.author = '';
    this.createdAt = Date.now();
    this.content = '';
  }
}

defineTypes(ChatMessage, {
  author: 'string',
  createdAt: 'number',
  content: 'string',
});

/**
 * Conversation schema - tracks which players are chatting together
 */
export class Conversation extends Schema {
  id: string;
  hostId: string;
  locked: boolean;

  constructor() {
    super();
    this.id = '';
    this.hostId = '';
    this.locked = false;
  }
}

defineTypes(Conversation, {
  id: 'string',
  hostId: 'string',
  locked: 'boolean',
});

/**
 * Hub world state
 */
export class HubState extends Schema {
  players: MapSchema<Player>;
  chatMessages: ArraySchema<ChatMessage>;
  conversations: MapSchema<Conversation>;

  constructor() {
    super();
    this.players = new MapSchema<Player>();
    this.chatMessages = new ArraySchema<ChatMessage>();
    this.conversations = new MapSchema<Conversation>();
  }
}

defineTypes(HubState, {
  players: { map: Player },
  chatMessages: [ChatMessage],
  conversations: { map: Conversation },
});
