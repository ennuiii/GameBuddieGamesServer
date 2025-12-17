/**
 * Love Letter Game Plugin
 */

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

export interface LoveLetterGameState {
  currentRound: number;
  deck: CardType[];
  removedCard: CardType | null; // The one removed secretly at start
  faceUpCards: CardType[]; // For 2 player games
  currentTurn: string | null; // Player ID
  turnPhase: 'draw' | 'play'; // Start of turn (draw) or ready to play card
  winner: string | null; // Winner of the game (collected enough tokens)
  roundWinner: string | null; // Winner of the current round
}

export interface LoveLetterPlayerData {
  hand: CardType[];
  discarded: CardType[];
  tokens: number; // Affection tokens
  isEliminated: boolean;
  isImmune: boolean; // From Handmaid
  seenBy: string[]; // List of player IDs who have seen this hand (Priest effect) - DEPRECATED
  isReady: boolean;
  seenHandSnapshots: { [observerId: string]: CardType[] }; // Hand snapshot for Priest effect
}

interface LoveLetterSettings {
  tokensToWin: number; // Configurable, defaults based on player count
}

// ============================================================================
// PLUGIN CLASS
// ============================================================================

class LoveLetterPlugin implements GamePlugin {
  id = 'loveletter';
  name = 'Love Letter';
  version = '1.0.0';
  description = 'Risk, deduction, and luck. Get your letter to the Princess!';
  author = 'GameBuddies';
  namespace = '/loveletter';
  basePath = '/loveletter';

  defaultSettings: RoomSettings = {
    minPlayers: 2,
    maxPlayers: 4,
    gameSpecific: {
      tokensToWin: 0 // 0 means auto-calculate based on players
    } as LoveLetterSettings
  };

  private io: any;

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
      currentTurn: null,
      turnPhase: 'draw',
      winner: null,
      roundWinner: null
    } as LoveLetterGameState;
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
      } as LoveLetterPlayerData;
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
    const playerData = player.gameData as LoveLetterPlayerData;
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
    const gameState = room.gameState.data as LoveLetterGameState;
    const requestingPlayer = Array.from(room.players.values()).find(p => p.socketId === socketId);

    return {
      code: room.code,
      hostId: room.hostId,
      players: Array.from(room.players.values()).map(p => {
        const pd = (p.gameData as LoveLetterPlayerData) || {
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
        roundWinner: gameState.roundWinner,
        winner: gameState.winner
      },
      settings: room.settings,
      mySocketId: socketId
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

      this.startNewGame(room);
      this.startNewRound(room);
      this.broadcastRoomState(room);
    },

    'player:ready': async (socket, data, room) => {
       // ... standard ready logic (omitted for brevity, assume auto-ready for now or implement if needed)
    },

    'player:draw': async (socket, data, room, helpers) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      const gameState = room.gameState.data as LoveLetterGameState;
      
      if (!player || gameState.currentTurn !== player.id || gameState.turnPhase !== 'draw') return;
      
      this.drawCardForCurrentPlayer(room);
      gameState.turnPhase = 'play';
      this.broadcastRoomState(room);
    },

    'play:card': async (socket, data, room, helpers) => {
      // data: { card: CardType, targetId?: string, guess?: CardType }
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      const gameState = room.gameState.data as LoveLetterGameState;
      
      if (!player || gameState.currentTurn !== player.id || room.gameState.phase !== 'playing') return;
      
      const playerData = player.gameData as LoveLetterPlayerData;
      const cardToPlay = data.card;

      // Validate: Player must have the card
      const cardIndex = playerData.hand.indexOf(cardToPlay);
      if (cardIndex === -1) return; // Cheating?

      // Validate: Countess Check
      // If holding King(6) or Prince(5) AND Countess(7), MUST play Countess
      if (playerData.hand.includes(7)) {
        if (playerData.hand.includes(5) || playerData.hand.includes(6)) {
          if (cardToPlay !== 7) {
             socket.emit('error', { message: 'You must play the Countess!' });
             return;
          }
        }
      }

      // Execute Play
      // 1. Remove from hand
      playerData.hand.splice(cardIndex, 1);
      // 2. Add to discards (visible history)
      playerData.discarded.push(cardToPlay);
      
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
    const gameState = room.gameState.data as LoveLetterGameState;
    gameState.currentRound = 0;
    gameState.winner = null;
    
    // Reset tokens
    room.players.forEach(p => {
        (p.gameData as LoveLetterPlayerData).tokens = 0;
    });
  }

  private startNewRound(room: Room) {
    const gameState = room.gameState.data as LoveLetterGameState;
    gameState.currentRound++;
    gameState.roundWinner = null;
    gameState.deck = this.createDeck();
    gameState.faceUpCards = [];
    gameState.removedCard = null;

    // Reset player round state
    room.players.forEach(p => {
        const pd = p.gameData as LoveLetterPlayerData;
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
        if (card) (p.gameData as LoveLetterPlayerData).hand.push(card);
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
    // 5x Guard (1)
    for(let i=0; i<5; i++) deck.push(1);
    // 2x Priest (2), Baron (3), Handmaid (4), Prince (5)
    for(let i=0; i<2; i++) { deck.push(2); deck.push(3); deck.push(4); deck.push(5); }
    // 1x King (6), Countess (7), Princess (8)
    deck.push(6); deck.push(7); deck.push(8);
    
    // Shuffle
    return deck.sort(() => Math.random() - 0.5);
  }

  private drawCardForCurrentPlayer(room: Room) {
      const gameState = room.gameState.data as LoveLetterGameState;
      if (gameState.deck.length > 0 && gameState.currentTurn) {
          const player = room.players.get(gameState.currentTurn);
          const pd = player?.gameData as LoveLetterPlayerData;
          if (pd && !pd.isEliminated) {
              const card = gameState.deck.pop();
              if (card) pd.hand.push(card);
          }
      }
  }

  private nextTurn(room: Room) {
    const gameState = room.gameState.data as LoveLetterGameState;
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
        const nextPd = nextPlayer?.gameData as LoveLetterPlayerData;
        
        if (nextPlayer?.connected && !nextPd.isEliminated) {
            gameState.currentTurn = nextId;
            gameState.turnPhase = 'draw';
            // Clear immunity from previous turn (it lasts until YOUR next turn)
            nextPd.isImmune = false; 
            
            // Clear seenBy for the player whose turn is next (i.e., this player's "sight" from a previous Priest play expires)
            players.forEach(p => {
                const pd = p.gameData as LoveLetterPlayerData;
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

  private async resolveCardEffect(room: Room, player: Player, card: CardType, targetId: string | undefined, guess: CardType | undefined, helpers: GameHelpers) {
      const gameState = room.gameState.data as LoveLetterGameState;
      const pd = player.gameData as LoveLetterPlayerData;
      
      // Helper to get target
      const getTarget = () => {
          if (!targetId) return null;
          const t = room.players.get(targetId);
          const tpd = t?.gameData as LoveLetterPlayerData;
          if (!t || !tpd || tpd.isEliminated) return null;
          if (tpd.isImmune && card !== 5) return null; // Prince can target immune players? No, usually immune blocks everything. 
          // Rule clarification: Prince targets a player. If immune, effect does nothing.
          // Wait, Prince can target yourself. Immune doesn't apply to self.
          if (tpd.isImmune && t.id !== player.id) return null; 
          return t;
      };

      // 8: Princess - If played/discarded, YOU die.
      if (card === 8) {
          pd.isEliminated = true;
          helpers.sendToRoom(room.code, 'game:log', { message: `${player.name} discarded the Princess and was eliminated!` });
          return;
      }

      // 5: Prince - Target discards hand and draws new.
      // Note: If you have Prince and Countess, you must play Countess. So Prince is only played if you don't have Countess.
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
               const tpd = target.gameData as LoveLetterPlayerData;
               const discardedCard = tpd.hand.pop();
               if (discardedCard) {
                   tpd.discarded.push(discardedCard);
                   helpers.sendToRoom(room.code, 'game:log', { message: `${player.name} forced ${target.name} to discard a card.` });
                   
                   // If Princess discarded, eliminated
                   if (discardedCard === 8) {
                       tpd.isEliminated = true;
                       helpers.sendToRoom(room.code, 'game:log', { message: `${target.name} discarded the Princess and was eliminated!` });
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

      // 7: Countess - No effect when played, just discarded.
      if (card === 7) {
          helpers.sendToRoom(room.code, 'game:log', { message: `${player.name} played the Countess.` });
          return;
      }

      // 4: Handmaid - Immunity
      if (card === 4) {
          pd.isImmune = true;
          helpers.sendToRoom(room.code, 'game:log', { message: `${player.name} is immune until next turn.` });
          return;
      }

      // TARGETING EFFECTS (Needs valid target)
      const target = getTarget();
      if (!target) {
          helpers.sendToRoom(room.code, 'game:log', { message: `${player.name} played ${this.getCardName(card)} but it had no effect.` });
          return; 
      }
      const tpd = target.gameData as LoveLetterPlayerData;

      // 1: Guard - Guess hand
      if (card === 1) {
          if (!guess || guess === 1) return; // Cannot guess Guard
          if (tpd.hand.includes(guess)) {
              tpd.isEliminated = true;
              helpers.sendToRoom(room.code, 'game:log', { message: `${player.name} correctly guessed ${target.name} had a ${this.getCardName(guess)}! ${target.name} is eliminated.` });
          } else {
              helpers.sendToRoom(room.code, 'game:log', { message: `${player.name} guessed ${target.name} had a ${this.getCardName(guess)}, but was wrong.` });
          }
      }

      // 2: Priest - Look at hand
      if (card === 2) {
          // Store a snapshot of the target's current hand for the observer
          tpd.seenHandSnapshots[player.id] = [...tpd.hand]; // Take a deep copy
          helpers.sendToRoom(room.code, 'game:log', { message: `${player.name} looked at ${target.name}'s hand.` });
      }

      // 3: Baron - Compare hands
      if (card === 3) {
          const myCard = pd.hand[0]; // Remaining card
          const theirCard = tpd.hand[0];
          
          if (myCard > theirCard) {
              tpd.isEliminated = true;
              helpers.sendToRoom(room.code, 'game:log', { message: `Baron Battle! ${player.name} (${myCard}) defeats ${target.name} (${theirCard}).` });
          } else if (theirCard > myCard) {
              pd.isEliminated = true;
              helpers.sendToRoom(room.code, 'game:log', { message: `Baron Battle! ${target.name} (${theirCard}) defeats ${player.name} (${myCard}).` });
          } else {
              helpers.sendToRoom(room.code, 'game:log', { message: `Baron Battle! It's a tie.` });
          }
      }

      // 6: King - Trade hands
      if (card === 6) {
          const myHand = [...pd.hand];
          const theirHand = [...tpd.hand];
          pd.hand = theirHand;
          tpd.hand = myHand;
          helpers.sendToRoom(room.code, 'game:log', { message: `${player.name} traded hands with ${target.name}.` });
      }
  }

  private checkRoundEnd(room: Room): boolean {
      const gameState = room.gameState.data as LoveLetterGameState;
      const activePlayers = Array.from(room.players.values())
          .filter(p => p.connected && !(p.gameData as LoveLetterPlayerData).isEliminated);

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
              const val = (p.gameData as LoveLetterPlayerData).hand[0] || 0;
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
             const getDiscardSum = (p: Player): number => (p.gameData as LoveLetterPlayerData).discarded.reduce((a: number, b) => a + b, 0);
             winners.sort((a,b) => getDiscardSum(b) - getDiscardSum(a));
             // Winner is first
          }
          
          this.endRound(room, winners[0].id);
          return true;
      }

      return false;
  }

  private endRound(room: Room, winnerId: string) {
      const gameState = room.gameState.data as LoveLetterGameState;
      const winner = room.players.get(winnerId);
      gameState.roundWinner = winnerId;
      
      if (winner) {
          const pd = winner.gameData as LoveLetterPlayerData;
          pd.tokens += 1;
          
          // Check Game Win
          const required = this.getTokensToWin(room.players.size);
          if (pd.tokens >= required) {
              gameState.winner = winnerId;
              this.endGame(room, `${winner.name} won the heart of the Princess!`);
              return;
          }
      }
      
      // Delay before next round? Client can handle animation, then Host clicks "Next Round" or auto after delay
      // For now, let's just leave it in "round ended" state and let Host restart/next round via event?
      // Or auto-restart after 5s?
      // Simplified: Just wait for Host to click "Start Round" or "Next Round" (reusing game:start or adding round:next)
      // We'll reuse 'game:start' to trigger next round if game not over.
      
      // Actually, let's set a timeout to auto-start next round for flow
      setTimeout(() => {
          if (!gameState.winner) {
             this.startNewRound(room);
             this.broadcastRoomState(room);
          }
      }, 5000);
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
      const names = ["?", "Guard", "Priest", "Baron", "Handmaid", "Prince", "King", "Countess", "Princess"];
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

export default new LoveLetterPlugin();