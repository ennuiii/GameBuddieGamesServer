/**
 * Prime Suspect Game Plugin
 */

import crypto from 'crypto';
import type {
  GamePlugin,
  Room,
  Player,
  SocketEventHandler,
  GameHelpers,
  RoomSettings
} from '../../core/types/core';
import type { Socket } from 'socket.io';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type CardType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; // 0 = card back (hidden)
type DiscardCardType = Exclude<CardType, 0>;

export interface PrimeSuspectDiscardEvent {
  card: DiscardCardType;
  playerId: string;
  playerName: string;
  timestamp: number;
  round: number;
  kind: 'play' | 'forced-discard';
}

export interface PrimeSuspectGameState {
  currentRound: number;
  deck: CardType[];
  removedCard: CardType | null; // The one removed secretly at start
  faceUpCards: CardType[]; // For 2 player games
  discardPile: PrimeSuspectDiscardEvent[]; // Chronological (oldest -> newest), per-round
  currentTurn: string | null; // Player ID
  turnPhase: 'draw' | 'play'; // Start of turn (draw) or ready to play card
  winner: string | null; // Winner of the game (collected enough tokens)
  roundWinner: string | null; // Winner of the current round
}

export interface PrimeSuspectPlayerData {
  hand: CardType[];
  discarded: CardType[];
  tokens: number; // Affection tokens
  isEliminated: boolean;
  isImmune: boolean; // From Lawyer
  seenBy: string[]; // List of player IDs who have seen this hand (Butler effect) - DEPRECATED
  isReady: boolean;
  seenHandSnapshots: { [observerId: string]: CardType[] }; // Hand snapshot for Butler effect
}

interface PrimeSuspectSettings {
  tokensToWin: number; // Configurable, defaults based on player count
}

// ============================================================================
// PLUGIN CLASS
// ============================================================================

class PrimeSuspectPlugin implements GamePlugin {
  id = 'primesuspect';
  name = 'Prime Suspect';
  version = '1.0.0';
  description = 'Risk, deduction, and luck. Solve the murder mystery!';
  author = 'GameBuddies';
  namespace = '/primesuspect';
  basePath = '/primesuspect';

  defaultSettings: RoomSettings = {
    minPlayers: 2,
    maxPlayers: 4,
    gameSpecific: {
      tokensToWin: 0 // 0 means auto-calculate based on players
    } as PrimeSuspectSettings
  };

  private io: any;

  // Track auto-start timeouts per room to prevent race conditions
  private roundStartTimeouts: Map<string, NodeJS.Timeout> = new Map();

  // ============================================================================
  // LIFECYCLE HOOKS
  // ============================================================================

  async onInitialize(io: any): Promise<void> {
    this.io = io;
    console.log(`[${this.name}] Plugin initialized`);
  }

  onRoomCreate(room: Room): void {
    room.gameState.data = {
      currentRound: 0,
      deck: [],
      removedCard: null,
      faceUpCards: [],
      discardPile: [],
      currentTurn: null,
      turnPhase: 'draw',
      winner: null,
      roundWinner: null
    } as PrimeSuspectGameState;
    room.gameState.phase = 'lobby';

    // Initialize data for existing players (e.g. host)
    room.players.forEach(player => {
      if (!player.gameData) {
        this.onPlayerJoin(room, player);
      }
    });
  }

  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    if (!isReconnecting) {
      player.gameData = {
        hand: [],
        discarded: [],
        tokens: 0,
        isEliminated: false,
        isImmune: false,
        seenBy: [],
        isReady: false,
        seenHandSnapshots: {}
      } as PrimeSuspectPlayerData;
    }
    this.broadcastRoomState(room);
  }

  onPlayerDisconnected(room: Room, player: Player): void {
    // Basic handling: if playing, maybe auto-eliminate? For now just pause/wait.
    // In a real game, you might skip their turn or eliminate them.
    this.broadcastRoomState(room);
  }

  onPlayerLeave(room: Room, player: Player): void {
     // If active game, eliminate them
    const playerData = player.gameData as PrimeSuspectPlayerData;
    if (room.gameState.phase === 'playing' && !playerData.isEliminated) {
        playerData.isEliminated = true;
        this.checkRoundEnd(room);
    }
    this.broadcastRoomState(room);
  }

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  serializeRoom(room: Room, socketId: string): any {
    const gameState = room.gameState.data as PrimeSuspectGameState;
    const requestingPlayer = Array.from(room.players.values()).find(p => p.socketId === socketId);

    return {
      code: room.code,
      hostId: room.hostId,
      players: Array.from(room.players.values()).map(p => {
        const pd = (p.gameData as PrimeSuspectPlayerData) || {
          hand: [], discarded: [], tokens: 0, isEliminated: false, isImmune: false, seenBy: [], isReady: false, seenHandSnapshots: {}
        };
        const isMe = p.socketId === socketId;
        
        let handToSend: CardType[];
        const actualHandLength = pd.hand.length;

        if (isMe || gameState.roundWinner !== null) {
            handToSend = pd.hand;
        } else if (requestingPlayer && pd.seenHandSnapshots[requestingPlayer.id]) {
            const currentActualHand = pd.hand; // The target's current actual hand
            const originalSnapshot = pd.seenHandSnapshots[requestingPlayer.id]; // The snapshot taken earlier

            const revealedCards: CardType[] = [];
            const currentHandCopy = [...currentActualHand]; // Copy to modify for comparison

            // Iterate through the original snapshot to identify cards still in hand
            for (const snapCard of originalSnapshot) {
                const indexInCurrentHand = currentHandCopy.indexOf(snapCard);
                if (indexInCurrentHand !== -1) {
                    revealedCards.push(snapCard); // This card from the snapshot is still in hand, reveal it
                    currentHandCopy.splice(indexInCurrentHand, 1); // Remove from copy to handle duplicates
                }
                // If snapCard is not found, it means it was played/discarded, so it's not revealed
            }

            // Fill the rest with card backs to match the actual hand length
            handToSend = [...revealedCards];
            while (handToSend.length < actualHandLength) {
                handToSend.push(0); // Card back for new/unknown cards
            }
        }
        else {
            handToSend = pd.hand.map(() => 0); // All card backs
        }
        // ...
        return {
          id: p.id,
          socketId: p.socketId,
          name: p.name,
          isHost: p.isHost,
          connected: p.connected,
          tokens: pd.tokens,
          isEliminated: pd.isEliminated,
          isImmune: pd.isImmune,
          isReady: pd.isReady,
          discarded: pd.discarded,
          hand: handToSend,
          handCount: actualHandLength
        };
      }),
      state: this.mapPhaseToClientState(room.gameState.phase),
      gameData: {
        currentRound: gameState.currentRound,
        currentTurn: gameState.currentTurn,
        turnPhase: gameState.turnPhase,
        deckCount: gameState.deck.length,
        faceUpCards: gameState.faceUpCards, // Visible to all
        discardPile: gameState.discardPile,
        roundWinner: gameState.roundWinner,
        winner: gameState.winner
      },
      settings: room.settings,
      mySocketId: socketId,
      messages: room.messages || []
    };
  }

  // ============================================================================
  // SOCKET HANDLERS
  // ============================================================================

  socketHandlers: Record<string, SocketEventHandler> = {
    'game:start': async (socket, data, room, helpers) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) return;
      console.log(`[${this.name}] Host ${player.name} attempting to start game. Players in room: ${room.players.size}`);
      if (room.players.size < 2) {
          helpers.sendToRoom(room.code, 'game:log', { message: `Need at least 2 players to start. Current: ${room.players.size}` });
          return;
      }

      // Clear any pending auto-start timeout to prevent race condition
      const existingTimeout = this.roundStartTimeouts.get(room.code);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.roundStartTimeouts.delete(room.code);
      }

      const gameState = room.gameState.data as PrimeSuspectGameState;

      // Only reset tokens for NEW game (winner exists = game ended, or still in lobby)
      // Don't reset when just starting a new round mid-game
      if (gameState.winner || room.gameState.phase === 'lobby') {
          this.startNewGame(room);
      }

      this.startNewRound(room);
      this.broadcastRoomState(room);
    },

    'player:ready': async (socket, data, room) => {
       // ... standard ready logic (omitted for brevity, assume auto-ready for now or implement if needed)
    },

    'player:draw': async (socket, data, room, helpers) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      const gameState = room.gameState.data as PrimeSuspectGameState;

      if (!player || gameState.currentTurn !== player.id || gameState.turnPhase !== 'draw') return;

      this.drawCardForCurrentPlayer(room);
      gameState.turnPhase = 'play';

      // Log draw action
      this.logGameMessage(room, `${player.name} drew a card.`, helpers);

      this.broadcastRoomState(room);
    },

    'play:card': async (socket, data, room, helpers) => {
      // data: { card: CardType, targetId?: string, guess?: CardType }
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      const gameState = room.gameState.data as PrimeSuspectGameState;
      
      if (!player || gameState.currentTurn !== player.id || room.gameState.phase !== 'playing') return;
      
      const playerData = player.gameData as PrimeSuspectPlayerData;
      const cardToPlay = data.card;
      if (cardToPlay === 0) return;

      // Validate: Player must have the card
      const cardIndex = playerData.hand.indexOf(cardToPlay);
      if (cardIndex === -1) return; // Cheating?

      // Validate: Accomplice Check
      // If holding Double Agent(6) or Blackmailer(5) AND Accomplice(7), MUST play Accomplice
      if (playerData.hand.includes(7)) {
        if (playerData.hand.includes(5) || playerData.hand.includes(6)) {
          if (cardToPlay !== 7) {
             socket.emit('error', { message: 'You must play the Accomplice!' });
             return;
          }
        }
      }

      // Execute Play
      // 1. Remove from hand
      playerData.hand.splice(cardIndex, 1);

      // 2. Update all observers' snapshots - remove the played card
      // This prevents newly drawn cards with the same value from being revealed
      for (const observerId in playerData.seenHandSnapshots) {
          const snapshot = playerData.seenHandSnapshots[observerId];
          const snapIndex = snapshot.indexOf(cardToPlay);
          if (snapIndex !== -1) {
              snapshot.splice(snapIndex, 1);
          }
      }

      // 3. Add to discards (visible history)
      playerData.discarded.push(cardToPlay);
      gameState.discardPile.push({
        card: cardToPlay,
        playerId: player.id,
        playerName: player.name,
        timestamp: Date.now(),
        round: gameState.currentRound,
        kind: 'play'
      });

      // Log play action with details based on card type
      let playLogMsg = `${player.name} played ${this.getCardName(cardToPlay)}`;

      // Add target info for targeting cards
      if (data.targetId && [1, 2, 3, 5, 6].includes(cardToPlay)) {
        const targetPlayer = room.players.get(data.targetId);
        if (targetPlayer) {
          playLogMsg += ` targeting ${targetPlayer.name}`;
        }
      }

      // Add guess info for Inspector
      if (cardToPlay === 1 && data.guess) {
        playLogMsg += `, guessing ${this.getCardName(data.guess)}`;
      }

      playLogMsg += '.';
      this.logGameMessage(room, playLogMsg, helpers);

      // 3. Resolve Effect
      await this.resolveCardEffect(room, player, cardToPlay, data.targetId, data.guess, helpers);
      
      // 4. Check End of Round (if deck empty or 1 player left)
      if (!this.checkRoundEnd(room)) {
          // 5. Next Turn
          this.nextTurn(room);
      }
      
      this.broadcastRoomState(room);
    }
  };

  // ============================================================================
  // GAME LOGIC
  // ============================================================================

  private startNewGame(room: Room) {
    room.gameState.phase = 'playing';
    const gameState = room.gameState.data as PrimeSuspectGameState;
    gameState.currentRound = 0;
    gameState.winner = null;
    
    // Reset tokens
    room.players.forEach(p => {
        (p.gameData as PrimeSuspectPlayerData).tokens = 0;
    });
  }

  private startNewRound(room: Room) {
    const gameState = room.gameState.data as PrimeSuspectGameState;
    gameState.currentRound++;
    gameState.roundWinner = null;
    gameState.deck = this.createDeck();
    gameState.faceUpCards = [];
    gameState.removedCard = null;
    gameState.discardPile = [];

    // Reset player round state
    room.players.forEach(p => {
        const pd = p.gameData as PrimeSuspectPlayerData;
        pd.hand = [];
        pd.discarded = [];
        pd.isEliminated = false;
        pd.isImmune = false;
        pd.seenBy = [];
        pd.seenHandSnapshots = {}; // Reset snapshots
    });

    // Setup Deck
    // Remove 1 card secretly
    gameState.removedCard = gameState.deck.pop() || null;

    // If 2 players, remove 3 more face up
    const activePlayers = Array.from(room.players.values()).filter(p => p.connected);
    if (activePlayers.length === 2) {
        gameState.faceUpCards.push(gameState.deck.pop()!);
        gameState.faceUpCards.push(gameState.deck.pop()!);
        gameState.faceUpCards.push(gameState.deck.pop()!);
    }

    // Deal 1 card to each
    activePlayers.forEach(p => {
        const card = gameState.deck.pop();
        if (card) (p.gameData as PrimeSuspectPlayerData).hand.push(card);
    });

    // Determine starter (winner of last round, or random/host for first)
    // For simplicity: continue order or random if first
    if (!gameState.currentTurn || !room.players.get(gameState.currentTurn)?.connected) {
         gameState.currentTurn = activePlayers[0].id;
    }
    
    // Set phase to draw, wait for player action
    gameState.turnPhase = 'draw';
    // this.drawCardForCurrentPlayer(room); // Removed for manual draw
  }

  private createDeck(): CardType[] {
    const deck: CardType[] = [];
    // 5x Inspector (1)
    for(let i=0; i<5; i++) deck.push(1);
    // 2x Butler (2), Witness (3), Lawyer (4), Blackmailer (5)
    for(let i=0; i<2; i++) { deck.push(2); deck.push(3); deck.push(4); deck.push(5); }
    // 1x Double Agent (6), Accomplice (7), The Murderer (8)
    deck.push(6); deck.push(7); deck.push(8);
    
    // Shuffle
    return deck.sort(() => Math.random() - 0.5);
  }

  private drawCardForCurrentPlayer(room: Room) {
      const gameState = room.gameState.data as PrimeSuspectGameState;
      if (gameState.deck.length > 0 && gameState.currentTurn) {
          const player = room.players.get(gameState.currentTurn);
          const pd = player?.gameData as PrimeSuspectPlayerData;
          if (pd && !pd.isEliminated) {
              const card = gameState.deck.pop();
              if (card) pd.hand.push(card);
          }
      }
  }

  private nextTurn(room: Room) {
    const gameState = room.gameState.data as PrimeSuspectGameState;
    const players = Array.from(room.players.values()); // Order matters, assuming consistent map iteration or sort by join
    // Ideally, GameBuddies core should provide a consistent player order list. 
    // We'll rely on map keys order for now or implement a seat system later. 
    // Assuming simple order:
    
    const activeIds = players.map(p => p.id);
    let currentIndex = activeIds.indexOf(gameState.currentTurn!);
    
    // Find next non-eliminated player
    let loops = 0;
    do {
        currentIndex = (currentIndex + 1) % activeIds.length;
        const nextId = activeIds[currentIndex];
        const nextPlayer = room.players.get(nextId);
        const nextPd = nextPlayer?.gameData as PrimeSuspectPlayerData;
        
        if (nextPlayer?.connected && !nextPd.isEliminated) {
            gameState.currentTurn = nextId;
            gameState.turnPhase = 'draw';
            // Clear immunity from previous turn (it lasts until YOUR next turn)
            nextPd.isImmune = false; 
            
            // Clear seenBy for the player whose turn is next (i.e., this player's "sight" from a previous Butler play expires)
            players.forEach(p => {
                const pd = p.gameData as PrimeSuspectPlayerData;
                const observerIndex = pd.seenBy.indexOf(nextId);
                if (observerIndex !== -1) {
                    pd.seenBy.splice(observerIndex, 1);
                }
            });
            
            return;
        }
        loops++;
    } while (loops < activeIds.length); // Prevent infinite loop if all eliminated (should be caught by checkRoundEnd)
  }

  // Helper to log game messages (persists to room.messages AND sends socket event)
  private logGameMessage(room: Room, message: string, helpers: GameHelpers) {
    room.messages = room.messages || [];
    room.messages.push({
      id: crypto.randomUUID(),
      playerId: 'system',
      playerName: 'Game',
      message,
      timestamp: Date.now()
    });
    helpers.sendToRoom(room.code, 'game:log', { message });
  }

  private async resolveCardEffect(room: Room, player: Player, card: CardType, targetId: string | undefined, guess: CardType | undefined, helpers: GameHelpers) {
      const gameState = room.gameState.data as PrimeSuspectGameState;
      const pd = player.gameData as PrimeSuspectPlayerData;

      // Helper to get target
      const getTarget = () => {
          if (!targetId) return null;
          const t = room.players.get(targetId);
          const tpd = t?.gameData as PrimeSuspectPlayerData;
          if (!t || !tpd || tpd.isEliminated) return null;
          if (tpd.isImmune && card !== 5) return null; // Blackmailer can target immune players? No, usually immune blocks everything.
          // Rule clarification: Blackmailer targets a player. If immune, effect does nothing.
          // Wait, Blackmailer can target yourself. Immune doesn't apply to self.
          if (tpd.isImmune && t.id !== player.id) return null; 
          return t;
      };

      // 8: The Murderer - If played/discarded, YOU are eliminated.
      if (card === 8) {
          pd.isEliminated = true;
          this.logGameMessage(room, `${player.name} discarded The Murderer and was eliminated!`, helpers);
          return;
      }

      // 5: Blackmailer - Target discards hand and draws new.
      // Note: If you have Blackmailer and Accomplice, you must play Accomplice. So Blackmailer is only played if you don't have Accomplice.
      if (card === 5) {
          // Can target self.
          let target = getTarget();
          // If no valid target (e.g. everyone else immune), rules say you MUST target yourself.
          // Or if specific targetId provided, try that.
          if (!target) {
               // Logic to auto-target self if others are immune? 
               // For now, client should send valid target. If client sends invalid, we might fallback or fail.
               // Assuming client enforces selection logic.
               if (targetId === player.id) target = player; 
          }
          
          if (target) {
               const tpd = target.gameData as PrimeSuspectPlayerData;
               const discardedCard = tpd.hand.pop() as DiscardCardType | undefined;
               if (discardedCard) {
                   tpd.discarded.push(discardedCard);
                   gameState.discardPile.push({
                     card: discardedCard,
                     playerId: target.id,
                     playerName: target.name,
                     timestamp: Date.now(),
                     round: gameState.currentRound,
                     kind: 'forced-discard'
                   });
                   this.logGameMessage(room, `${target.name} discarded ${this.getCardName(discardedCard)}.`, helpers);

                   // If The Murderer discarded, eliminated
                   if (discardedCard === 8) {
                       tpd.isEliminated = true;
                       this.logGameMessage(room, `${target.name} is eliminated!`, helpers);
                   } else {
                       // Draw new
                       const newCard = gameState.deck.pop();
                       if (newCard) {
                           tpd.hand.push(newCard);
                       } else {
                           // Deck empty? Take the removed card (start of game card)
                           if (gameState.removedCard) {
                               tpd.hand.push(gameState.removedCard);
                               gameState.removedCard = null; // Taken
                           }
                       }
                   }
               }
          }
          return;
      }

      // 7: Accomplice - No effect when played, just discarded.
      if (card === 7) {
          // No additional log needed - play action already logged
          return;
      }

      // 4: Lawyer - Immunity
      if (card === 4) {
          pd.isImmune = true;
          this.logGameMessage(room, `${player.name} is now immune until their next turn.`, helpers);
          return;
      }

      // TARGETING EFFECTS (Needs valid target)
      const target = getTarget();
      if (!target) {
          this.logGameMessage(room, `No valid target - no effect.`, helpers);
          return;
      }
      const tpd = target.gameData as PrimeSuspectPlayerData;

      // 1: Inspector - Guess hand
      if (card === 1) {
          if (!guess || guess === 1) return; // Cannot guess Inspector
          if (tpd.hand.includes(guess)) {
              tpd.isEliminated = true;
              this.logGameMessage(room, `Correct! ${target.name} had ${this.getCardName(guess)} and is eliminated!`, helpers);
          } else {
              this.logGameMessage(room, `Wrong! ${target.name} did not have ${this.getCardName(guess)}.`, helpers);
          }
      }

      // 2: Butler - Look at hand
      if (card === 2) {
          // Store a snapshot of the target's current hand for the observer
          tpd.seenHandSnapshots[player.id] = [...tpd.hand]; // Take a deep copy
          this.logGameMessage(room, `${player.name} sees ${target.name}'s hand.`, helpers);
      }

      // 3: Witness - Compare hands (Confrontation)
      if (card === 3) {
          const myCard = pd.hand[0]; // Remaining card
          const theirCard = tpd.hand[0];

          // Safety check for undefined hands
          if (myCard === undefined || theirCard === undefined) {
              this.logGameMessage(room, `Witness Confrontation failed - invalid hand state.`, helpers);
              return;
          }

          if (myCard > theirCard) {
              tpd.isEliminated = true;
              this.logGameMessage(room, `${player.name} wins! ${target.name} (${this.getCardName(theirCard)}) is eliminated.`, helpers);
          } else if (theirCard > myCard) {
              pd.isEliminated = true;
              this.logGameMessage(room, `${target.name} wins! ${player.name} (${this.getCardName(myCard)}) is eliminated.`, helpers);
          } else {
              this.logGameMessage(room, `It's a tie! Both had ${this.getCardName(myCard)}.`, helpers);
          }
      }

      // 6: Double Agent - Trade hands
      if (card === 6) {
          const myHand = [...pd.hand];
          const theirHand = [...tpd.hand];
          pd.hand = theirHand;
          tpd.hand = myHand;
          this.logGameMessage(room, `${player.name} and ${target.name} traded hands.`, helpers);
      }
  }

  private checkRoundEnd(room: Room): boolean {
      const gameState = room.gameState.data as PrimeSuspectGameState;
      const activePlayers = Array.from(room.players.values())
          .filter(p => p.connected && !(p.gameData as PrimeSuspectPlayerData).isEliminated);

      // Condition 1: One player left
      if (activePlayers.length === 1) {
          this.endRound(room, activePlayers[0].id);
          return true;
      }

      // Condition 2: Deck empty
      if (gameState.deck.length === 0) {
          // Compare hands
          let highestVal = -1;
          let winners: Player[] = [];
          
          activePlayers.forEach(p => {
              const val = (p.gameData as PrimeSuspectPlayerData).hand[0] || 0;
              if (val > highestVal) {
                  highestVal = val;
                  winners = [p];
              } else if (val === highestVal) {
                  // Tie-breaker: Sum of discarded cards
                  winners.push(p);
              }
          });
          
          if (winners.length > 1) {
             // Calculate discard sums
             const getDiscardSum = (p: Player): number => (p.gameData as PrimeSuspectPlayerData).discarded.reduce((a: number, b) => a + b, 0);
             winners.sort((a,b) => getDiscardSum(b) - getDiscardSum(a));
             // Winner is first
          }
          
          this.endRound(room, winners[0].id);
          return true;
      }

      return false;
  }

  private endRound(room: Room, winnerId: string) {
      const gameState = room.gameState.data as PrimeSuspectGameState;
      const winner = room.players.get(winnerId);
      gameState.roundWinner = winnerId;

      if (winner) {
          const pd = winner.gameData as PrimeSuspectPlayerData;
          pd.tokens += 1;

          // Immediate broadcast so clients see token update right away
          this.broadcastRoomState(room);

          // Check Game Win
          const required = this.getTokensToWin(room.players.size);
          if (pd.tokens >= required) {
              gameState.winner = winnerId;
              this.endGame(room, `${winner.name} solved the case!`);
              return;
          }
      }
      
      // Auto-start next round after 5s delay (clear any existing timeout first)
      const existingTimeout = this.roundStartTimeouts.get(room.code);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeoutId = setTimeout(() => {
          this.roundStartTimeouts.delete(room.code);
          if (!gameState.winner) {
             this.startNewRound(room);
             this.broadcastRoomState(room);
          }
      }, 5000);

      this.roundStartTimeouts.set(room.code, timeoutId);
  }
  
  private endGame(room: Room, message: string) {
       room.gameState.phase = 'ended';
       this.io.of(this.namespace).to(room.code).emit('game:ended', { message });
  }

  private getTokensToWin(playerCount: number): number {
      if (playerCount === 2) return 7;
      if (playerCount === 3) return 5;
      return 4;
  }

  private getCardName(card: number): string {
      const names = ["?", "Inspector", "Butler", "Witness", "Lawyer", "Blackmailer", "Double Agent", "Accomplice", "The Murderer"];
      return names[card] || "Unknown";
  }

  private mapPhaseToClientState(phase: string): string {
    return phase === 'lobby' ? 'LOBBY' : (phase === 'ended' ? 'ENDED' : 'PLAYING');
  }

  private broadcastRoomState(room: Room): void {
    if (!this.io) return;
    room.players.forEach(player => {
      const serialized = this.serializeRoom(room, player.socketId);
      this.io.of(this.namespace).to(player.socketId).emit('roomStateUpdated', serialized);
    });
  }
}

export default new PrimeSuspectPlugin();
