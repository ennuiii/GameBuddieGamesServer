/**
 * Colyseus message types for Hub room
 */
export enum Message {
  UPDATE_PLAYER = 0,
  UPDATE_PLAYER_NAME = 1,
  ADD_CHAT_MESSAGE = 2,
  SEND_ROOM_DATA = 3,
  // Conversation messages (client → server)
  START_CONVERSATION = 4,    // Start conversation with another player
  LEAVE_CONVERSATION = 5,    // Leave current conversation
  REQUEST_JOIN = 6,          // Request to join existing conversation
  APPROVE_JOIN = 7,          // Host approves join request
  DENY_JOIN = 8,             // Host denies join request
  LOCK_CONVERSATION = 9,     // Host toggles conversation lock
  // Server notifications (server → client)
  CONVERSATION_UPDATED = 10, // Conversation state changed
  JOIN_REQUESTED = 11,       // Someone wants to join (sent to host)
  JOIN_DENIED = 12,          // Join request was denied (sent to requester)
}
