/**
 * Jackpot Crusaders - Main Game Plugin
 *
 * A multiplayer slot machine RPG where 2-4 players team up against bosses.
 *
 * @author GameBuddies
 * @version 1.0.0
 */

import type {
  GamePlugin,
  Room,
  Player,
  SocketEventHandler,
  GameHelpers,
  RoomSettings
} from '../../core/types/core.js';
import type { Socket } from 'socket.io';
import type {
  JackpotGameState,
  JackpotPlayerData,
  JackpotGameSettings,
  BossData,
  ShopItem,
  SpinResult,
  SpinEffect,
  BattleLogEntry,
  GamePhase
} from './types.js';
import {
  DEFAULT_SETTINGS,
  BOSSES,
  SHOP_ITEMS_BY_TIER,
  GOLD_REWARDS,
  TIMING
} from './constants.js';
import {
  createSlotMachine,
  processPlayerSpin,
  addSymbol,
  removeSymbol,
  removeAllOfType,
  upgradeAllSymbols
} from './SlotMachine.js';

// ============================================================================
// PLUGIN CLASS
// ============================================================================

class JackpotCrusadersPlugin implements GamePlugin {
  // ============================================================================
  // PLUGIN METADATA
  // ============================================================================

  id = 'jackpot-crusaders';
  name = 'Jackpot Crusaders';
  version = '1.0.0';
  description = 'A multiplayer slot machine RPG where players team up against bosses';
  author = 'GameBuddies';
  namespace = '/jackpot-crusaders';
  basePath = '/jackpot-crusaders';

  // ============================================================================
  // DEFAULT SETTINGS
  // ============================================================================

  defaultSettings: RoomSettings = {
    minPlayers: 2,
    maxPlayers: 4,
    gameSpecific: DEFAULT_SETTINGS
  };

  // ============================================================================
  // PRIVATE PROPERTIES
  // ============================================================================

  private io: any;
  private timers = new Map<string, NodeJS.Timeout>();
  private intervals = new Map<string, NodeJS.Timeout>();

  // ============================================================================
  // LIFECYCLE HOOKS
  // ============================================================================

  async onInitialize(io: any): Promise<void> {
    this.io = io;
    console.log(`[${this.name}] Plugin initialized`);
  }

  onRoomCreate(room: Room): void {
    console.log(`[${this.name}] Room created: ${room.code}`);

    // Initialize game state
    room.gameState.data = {
      phase: 'lobby',
      boss: null,
      bossesDefeated: 0,
      currentRound: 0,
      shopTimeRemaining: 0,
      shopItems: [],
      battleLog: []
    } as JackpotGameState;

    room.gameState.phase = 'lobby';

    // Initialize host player's gameData
    // (onPlayerJoin is not called for the host since they're added during room creation)
    const hostPlayer = room.players.get(room.hostId);
    if (hostPlayer && !hostPlayer.gameData) {
      const settings = room.settings.gameSpecific as JackpotGameSettings;
      hostPlayer.gameData = {
        slotMachine: createSlotMachine(),
        health: settings.startingHealth,
        maxHealth: settings.startingHealth,
        gold: settings.startingGold,
        buffs: [],
        debuffs: [],
        damageDealt: 0,
        healingDone: 0,
        criticalHits: 0,
        selfDamage: 0,
        isReady: false
      } as JackpotPlayerData;
      console.log(`[${this.name}] Initialized host player ${hostPlayer.name} with gameData`);
    }
  }

  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    console.log(`[${this.name}] Player ${player.name} ${isReconnecting ? 'reconnected to' : 'joined'} room ${room.code}`);

    const settings = room.settings.gameSpecific as JackpotGameSettings;

    if (!isReconnecting) {
      // Initialize player data
      player.gameData = {
        slotMachine: createSlotMachine(),
        health: settings.startingHealth,
        maxHealth: settings.startingHealth,
        gold: settings.startingGold,
        buffs: [],
        debuffs: [],
        damageDealt: 0,
        healingDone: 0,
        criticalHits: 0,
        selfDamage: 0,
        isReady: false
      } as JackpotPlayerData;
    }

    this.broadcastRoomState(room);
  }

  onPlayerDisconnected(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} disconnected from room ${room.code}`);
    this.broadcastRoomState(room);
  }

  onPlayerLeave(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} left room ${room.code}`);

    const gameState = room.gameState.data as JackpotGameState;

    // Check if game should end due to insufficient players
    const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
    if (gameState.phase !== 'lobby' && connectedPlayers.length < room.settings.minPlayers) {
      this.endGame(room, false, 'Not enough players');
    }

    this.broadcastRoomState(room);
  }

  onRoomDestroy(room: Room): void {
    console.log(`[${this.name}] Room ${room.code} destroyed`);
    this.clearRoomTimers(room.code);
  }

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  serializeRoom(room: Room, socketId: string): any {
    const gameState = room.gameState.data as JackpotGameState;

    return {
      code: room.code,
      hostId: room.hostId,

      players: Array.from(room.players.values()).map(p => {
        const playerData = p.gameData as JackpotPlayerData;
        return {
          socketId: p.socketId,
          id: p.id,
          name: p.name,
          isHost: p.isHost,
          connected: p.connected,
          disconnectedAt: p.disconnectedAt,
          // Game data
          health: playerData?.health || 0,
          maxHealth: playerData?.maxHealth || 100,
          gold: playerData?.gold || 0,
          isReady: playerData?.isReady || false,
          slotMachine: playerData?.slotMachine || null,
          buffs: playerData?.buffs || [],
          debuffs: playerData?.debuffs || [],
          // Stats
          damageDealt: playerData?.damageDealt || 0,
          healingDone: playerData?.healingDone || 0
        };
      }),

      state: this.mapPhaseToClientState(gameState.phase),

      gameData: {
        phase: gameState.phase,
        boss: gameState.boss,
        bossesDefeated: gameState.bossesDefeated,
        currentRound: gameState.currentRound,
        shopTimeRemaining: gameState.shopTimeRemaining,
        shopItems: gameState.shopItems,
        battleLog: gameState.battleLog.slice(-20)  // Last 20 entries
      },

      settings: {
        ...room.settings,
        gameSpecific: room.settings.gameSpecific as JackpotGameSettings
      },

      messages: room.messages.slice(-100),
      mySocketId: socketId,
      isGameBuddiesRoom: room.isGameBuddiesRoom || false
    };
  }

  // ============================================================================
  // SOCKET EVENT HANDLERS
  // ============================================================================

  socketHandlers: Record<string, SocketEventHandler> = {
    /**
     * Start the game (host only)
     */
    'game:start': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const player = this.getPlayerBySocket(room, socket.id);
        if (!player?.isHost) {
          socket.emit('error', { message: 'Only the host can start the game' });
          return;
        }

        const connectedPlayers = this.getConnectedPlayers(room);
        if (connectedPlayers.length < room.settings.minPlayers) {
          socket.emit('error', { message: `Need at least ${room.settings.minPlayers} players` });
          return;
        }

        // Start with shop phase
        this.startShopPhase(room);

        helpers.sendToRoom(room.code, 'game:started', {
          message: 'The adventure begins!'
        });

        this.addLogEntry(room, null, 'phase', 'The adventure begins!');
        this.broadcastRoomState(room);

        console.log(`[${this.name}] Game started in room ${room.code}`);
      } catch (error) {
        console.error(`[${this.name}] Error starting game:`, error);
        socket.emit('error', { message: 'Failed to start game' });
      }
    },

    /**
     * Player ready toggle (shop phase)
     */
    'player:ready': async (socket: Socket, data: { ready: boolean }, room: Room, helpers: GameHelpers) => {
      try {
        const player = this.getPlayerBySocket(room, socket.id);
        if (!player) return;

        const playerData = player.gameData as JackpotPlayerData;
        const gameState = room.gameState.data as JackpotGameState;

        if (gameState.phase !== 'shop') {
          socket.emit('error', { message: 'Can only ready during shop phase' });
          return;
        }

        playerData.isReady = data.ready;

        // Check if all players ready
        const allReady = this.getConnectedPlayers(room).every(
          p => (p.gameData as JackpotPlayerData).isReady
        );

        if (allReady) {
          this.startBattlePhase(room);
        }

        this.broadcastRoomState(room);
      } catch (error) {
        console.error(`[${this.name}] Error toggling ready:`, error);
      }
    },

    /**
     * Buy item from shop
     */
    'shop:buy': async (socket: Socket, data: { itemId: string }, room: Room, helpers: GameHelpers) => {
      try {
        const player = this.getPlayerBySocket(room, socket.id);
        if (!player) return;

        const playerData = player.gameData as JackpotPlayerData;
        if (!playerData) {
          socket.emit('error', { message: 'Player data not initialized' });
          return;
        }

        const gameState = room.gameState.data as JackpotGameState;

        if (gameState.phase !== 'shop') {
          socket.emit('error', { message: 'Can only buy during shop phase' });
          return;
        }

        // Find item
        const item = gameState.shopItems.find(i => i.id === data.itemId);
        if (!item) {
          socket.emit('error', { message: 'Item not found' });
          return;
        }

        // Check gold
        if (playerData.gold < item.cost) {
          socket.emit('error', { message: 'Not enough gold' });
          return;
        }

        // Apply purchase
        playerData.gold -= item.cost;
        this.applyShopItem(playerData, item);

        socket.emit('shop:bought', { itemId: item.id, newGold: playerData.gold });
        this.addLogEntry(room, player.id, 'effect', `${player.name} bought ${item.name}`);
        this.broadcastRoomState(room);
      } catch (error) {
        console.error(`[${this.name}] Error buying item:`, error);
        socket.emit('error', { message: 'Failed to buy item' });
      }
    },

    /**
     * Remove symbol from slot machine
     */
    'shop:remove': async (socket: Socket, data: { symbolIndex: number }, room: Room, helpers: GameHelpers) => {
      try {
        const player = this.getPlayerBySocket(room, socket.id);
        if (!player) return;

        const playerData = player.gameData as JackpotPlayerData;
        const gameState = room.gameState.data as JackpotGameState;

        if (gameState.phase !== 'shop') {
          socket.emit('error', { message: 'Can only remove during shop phase' });
          return;
        }

        // Check for removal cost (free if they have removal item pending)
        const removalCost = 8;
        if (playerData.gold < removalCost) {
          socket.emit('error', { message: 'Not enough gold for removal' });
          return;
        }

        const success = removeSymbol(playerData.slotMachine, data.symbolIndex);
        if (!success) {
          socket.emit('error', { message: 'Cannot remove symbol (minimum 4 required)' });
          return;
        }

        playerData.gold -= removalCost;
        socket.emit('shop:removed', { symbolIndex: data.symbolIndex });
        this.broadcastRoomState(room);
      } catch (error) {
        console.error(`[${this.name}] Error removing symbol:`, error);
        socket.emit('error', { message: 'Failed to remove symbol' });
      }
    },

    /**
     * Restart game (host only)
     */
    'game:restart': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const player = this.getPlayerBySocket(room, socket.id);
        if (!player?.isHost) {
          socket.emit('error', { message: 'Only the host can restart' });
          return;
        }

        this.resetGame(room);
        helpers.sendToRoom(room.code, 'game:restarted', {});
        this.broadcastRoomState(room);

        console.log(`[${this.name}] Game restarted in room ${room.code}`);
      } catch (error) {
        console.error(`[${this.name}] Error restarting:`, error);
        socket.emit('error', { message: 'Failed to restart game' });
      }
    }
  };

  // ============================================================================
  // PHASE MANAGEMENT
  // ============================================================================

  private startShopPhase(room: Room): void {
    const gameState = room.gameState.data as JackpotGameState;
    const settings = room.settings.gameSpecific as JackpotGameSettings;

    gameState.phase = 'shop';
    gameState.shopTimeRemaining = settings.shopDuration;

    // Reset player ready states
    room.players.forEach(p => {
      const pd = p.gameData as JackpotPlayerData;
      if (pd) pd.isReady = false;
    });

    // Generate shop items based on progression
    const tier = Math.min(gameState.bossesDefeated + 1, 3);
    gameState.shopItems = this.generateShopItems(tier);

    // Start shop timer
    this.startShopTimer(room);

    this.addLogEntry(room, null, 'phase', `Shop Phase - ${settings.shopDuration}s to prepare!`);

    if (this.io) {
      const namespace = this.io.of(this.namespace);
      namespace.to(room.code).emit('phase:shop', {
        duration: settings.shopDuration,
        items: gameState.shopItems
      });
    }
  }

  private startBattlePhase(room: Room): void {
    const gameState = room.gameState.data as JackpotGameState;

    // Clear shop timer
    this.clearTimer(`${room.code}:shop`);

    gameState.phase = 'battle';
    gameState.currentRound = 0;

    // Spawn boss
    const bossIndex = gameState.bossesDefeated;
    if (bossIndex >= BOSSES.length) {
      this.endGame(room, true, 'All bosses defeated!');
      return;
    }

    const bossTemplate = BOSSES[bossIndex];
    gameState.boss = {
      ...bossTemplate,
      currentHealth: bossTemplate.maxHealth,
      enraged: false,
      bossIndex
    };

    this.addLogEntry(room, null, 'boss_attack', `${gameState.boss.name} appears!`);

    if (this.io) {
      const namespace = this.io.of(this.namespace);
      namespace.to(room.code).emit('phase:battle', {
        boss: gameState.boss
      });
    }

    // Start auto-spin loop
    this.startBattleLoop(room);
  }

  // ============================================================================
  // BATTLE LOOP
  // ============================================================================

  private startBattleLoop(room: Room): void {
    const settings = room.settings.gameSpecific as JackpotGameSettings;
    const intervalKey = `${room.code}:battle`;

    // Clear any existing interval
    this.clearTimer(intervalKey);

    const battleInterval = setInterval(() => {
      // Check if room still exists and has valid state
      if (!room.gameState?.data) {
        clearInterval(battleInterval);
        this.intervals.delete(intervalKey);
        return;
      }

      const gameState = room.gameState.data as JackpotGameState;

      // Check if still in battle
      if (!gameState || gameState.phase !== 'battle') {
        clearInterval(battleInterval);
        this.intervals.delete(intervalKey);
        return;
      }

      // Execute battle round
      this.executeBattleRound(room);
    }, settings.spinInterval);

    this.intervals.set(intervalKey, battleInterval);
  }

  private executeBattleRound(room: Room): void {
    const gameState = room.gameState.data as JackpotGameState;
    if (!gameState) return;  // Room might be destroyed

    const boss = gameState.boss;
    if (!boss) return;

    gameState.currentRound++;

    // Process all player spins
    const spinResults: SpinResult[] = [];
    const connectedPlayers = this.getConnectedPlayers(room);

    for (const player of connectedPlayers) {
      const playerData = player.gameData as JackpotPlayerData;
      if (!playerData || playerData.health <= 0) continue;  // Dead players or uninitialized don't spin

      // Use socketId as playerId for client-side slot machine lookup
      const result = processPlayerSpin(player.socketId, playerData);
      spinResults.push(result);

      // Apply effects
      this.applySpinEffects(room, player, result.effects);
    }

    // Boss attacks all living players
    this.bossAttack(room);

    // Check for boss defeat
    if (boss.currentHealth <= 0) {
      this.onBossDefeated(room);
      return;
    }

    // Check for party wipe
    const livingPlayers = connectedPlayers.filter(p => {
      const pd = p.gameData as JackpotPlayerData;
      return pd && pd.health > 0;
    });
    if (livingPlayers.length === 0) {
      this.endGame(room, false, 'Party wiped!');
      return;
    }

    // Broadcast spin results
    if (this.io) {
      const namespace = this.io.of(this.namespace);
      namespace.to(room.code).emit('battle:round', {
        round: gameState.currentRound,
        spinResults,
        bossHealth: boss.currentHealth
      });
    }

    this.broadcastRoomState(room);
  }

  private applySpinEffects(room: Room, player: Player, effects: SpinEffect[]): void {
    const gameState = room.gameState.data as JackpotGameState;
    const playerData = player.gameData as JackpotPlayerData;
    const boss = gameState.boss;

    for (const effect of effects) {
      switch (effect.type) {
        case 'damage':
          if (boss) {
            // Apply boss defense
            const damage = Math.round(effect.value * (1 - boss.defense / 100));
            boss.currentHealth = Math.max(0, boss.currentHealth - damage);
            playerData.damageDealt += damage;

            // Check enrage
            if (!boss.enraged && boss.currentHealth <= boss.maxHealth * TIMING.enrageThreshold) {
              boss.enraged = true;
              this.addLogEntry(room, null, 'boss_attack', `${boss.name} becomes ENRAGED!`);
            }

            this.addLogEntry(room, player.id, 'damage', `${player.name} dealt ${damage} damage!`, damage);
          }
          break;

        case 'heal':
          if (effect.target === 'party') {
            // Heal all living players
            this.getConnectedPlayers(room).forEach(p => {
              const pd = p.gameData as JackpotPlayerData;
              if (pd.health > 0) {
                const healAmount = Math.min(effect.value, pd.maxHealth - pd.health);
                pd.health += healAmount;
                if (p.id === player.id) {
                  playerData.healingDone += healAmount;
                }
              }
            });
            this.addLogEntry(room, player.id, 'heal', `${player.name} healed the party for ${effect.value}!`, effect.value);
          } else {
            const healAmount = Math.min(effect.value, playerData.maxHealth - playerData.health);
            playerData.health += healAmount;
            playerData.healingDone += healAmount;
          }
          break;

        case 'self_damage':
          playerData.health = Math.max(0, playerData.health - effect.value);
          playerData.selfDamage += effect.value;
          this.addLogEntry(room, player.id, 'damage', `${player.name} hurt themselves for ${effect.value}!`, effect.value);
          break;

        case 'gold':
          playerData.gold += effect.value;
          this.addLogEntry(room, player.id, 'effect', `${player.name} earned ${effect.value} gold!`, effect.value);
          break;

        case 'buff':
          // Simplified buff handling
          playerData.buffs.push({
            id: `buff_${Date.now()}`,
            name: effect.bonus || 'Buff',
            type: 'buff',
            stacks: effect.value,
            duration: 3,
            effectType: 'defense',
            value: 10
          });
          break;
      }
    }
  }

  private bossAttack(room: Room): void {
    const gameState = room.gameState.data as JackpotGameState;
    const boss = gameState.boss;
    if (!boss) return;

    // Calculate damage (increased if enraged)
    let damage = boss.attack;
    if (boss.enraged) {
      damage = Math.round(damage * 1.5);
    }

    // Check for special ability
    for (const ability of boss.abilities) {
      if (Math.random() < ability.chance) {
        this.executeBossAbility(room, ability);
      }
    }

    // Deal damage to all living players
    const connectedPlayers = this.getConnectedPlayers(room);
    for (const player of connectedPlayers) {
      const playerData = player.gameData as JackpotPlayerData;
      if (!playerData || playerData.health <= 0) continue;

      // Apply player defense buffs
      let finalDamage = damage;
      const defenseBuffs = (playerData.buffs || []).filter(b => b.effectType === 'defense');
      for (const buff of defenseBuffs) {
        finalDamage = Math.round(finalDamage * (1 - buff.value / 100));
      }

      playerData.health = Math.max(0, playerData.health - finalDamage);

      if (playerData.health === 0) {
        this.addLogEntry(room, player.id, 'defeat', `${player.name} has fallen!`);
      }
    }

    // Decrement buff durations
    connectedPlayers.forEach(p => {
      const pd = p.gameData as JackpotPlayerData;
      if (!pd) return;
      pd.buffs = (pd.buffs || [])
        .map(b => ({ ...b, duration: b.duration - 1 }))
        .filter(b => b.duration > 0);
      pd.debuffs = (pd.debuffs || [])
        .map(b => ({ ...b, duration: b.duration - 1 }))
        .filter(b => b.duration > 0);
    });

    this.addLogEntry(room, null, 'boss_attack', `${boss.name} attacks for ${damage} damage!`, damage);
  }

  private executeBossAbility(room: Room, ability: typeof BOSSES[0]['abilities'][0]): void {
    const gameState = room.gameState.data as JackpotGameState;
    const boss = gameState.boss;
    if (!boss) return;

    this.addLogEntry(room, null, 'boss_attack', `${boss.name} uses ${ability.name}!`);

    switch (ability.effect) {
      case 'aoe':
        // Extra damage to all players
        this.getConnectedPlayers(room).forEach(p => {
          const pd = p.gameData as JackpotPlayerData;
          if (pd.health > 0) {
            pd.health = Math.max(0, pd.health - ability.value);
          }
        });
        break;

      case 'steal':
        // Steal gold from random player
        const players = this.getConnectedPlayers(room).filter(p =>
          (p.gameData as JackpotPlayerData).gold > 0
        );
        if (players.length > 0) {
          const target = players[Math.floor(Math.random() * players.length)];
          const pd = target.gameData as JackpotPlayerData;
          const stolen = Math.min(ability.value, pd.gold);
          pd.gold -= stolen;
          this.addLogEntry(room, target.id, 'effect', `${boss.name} stole ${stolen} gold from ${target.name}!`);
        }
        break;

      case 'curse':
        // Apply curse debuff
        this.getConnectedPlayers(room).forEach(p => {
          const pd = p.gameData as JackpotPlayerData;
          pd.debuffs.push({
            id: `curse_${Date.now()}`,
            name: 'Curse',
            type: 'debuff',
            stacks: 1,
            duration: ability.value,
            effectType: 'attack',
            value: -20
          });
        });
        break;
    }
  }

  private onBossDefeated(room: Room): void {
    const gameState = room.gameState.data as JackpotGameState;
    const boss = gameState.boss;
    if (!boss) return;

    // Clear battle loop
    this.clearTimer(`${room.code}:battle`);

    gameState.bossesDefeated++;
    this.addLogEntry(room, null, 'victory', `${boss.name} has been defeated!`);

    // Distribute rewards
    const goldReward = GOLD_REWARDS.bossDefeat[boss.bossIndex] || 50;
    this.getConnectedPlayers(room).forEach(p => {
      const pd = p.gameData as JackpotPlayerData;
      pd.gold += goldReward;
      if (pd.health > 0) {
        pd.gold += GOLD_REWARDS.survivalBonus;
      }
    });

    if (this.io) {
      const namespace = this.io.of(this.namespace);
      namespace.to(room.code).emit('boss:defeated', {
        bossName: boss.name,
        goldReward,
        bossesDefeated: gameState.bossesDefeated
      });
    }

    // Check for victory
    const settings = room.settings.gameSpecific as JackpotGameSettings;
    if (gameState.bossesDefeated >= settings.bossCount) {
      this.endGame(room, true, 'All bosses defeated!');
      return;
    }

    // Heal players between bosses
    this.getConnectedPlayers(room).forEach(p => {
      const pd = p.gameData as JackpotPlayerData;
      pd.health = Math.min(pd.maxHealth, pd.health + 30);  // Heal 30 HP
    });

    // Start next shop phase after delay
    setTimeout(() => {
      if ((room.gameState.data as JackpotGameState).phase !== 'victory') {
        this.startShopPhase(room);
        this.broadcastRoomState(room);
      }
    }, TIMING.phaseTransitionDelay);
  }

  // ============================================================================
  // SHOP HELPERS
  // ============================================================================

  private startShopTimer(room: Room): void {
    const settings = room.settings.gameSpecific as JackpotGameSettings;
    const timerKey = `${room.code}:shop`;

    this.clearTimer(timerKey);

    const interval = setInterval(() => {
      const gameState = room.gameState.data as JackpotGameState;

      if (gameState.phase !== 'shop') {
        clearInterval(interval);
        this.intervals.delete(timerKey);
        return;
      }

      gameState.shopTimeRemaining--;

      // Broadcast updated timer to clients every tick
      this.broadcastRoomState(room);

      if (gameState.shopTimeRemaining <= 0) {
        clearInterval(interval);
        this.intervals.delete(timerKey);
        this.startBattlePhase(room);
      }
    }, 1000);

    this.intervals.set(timerKey, interval);
  }

  private generateShopItems(maxTier: number): ShopItem[] {
    const items: ShopItem[] = [];

    // Add items from all unlocked tiers
    for (let tier = 1; tier <= maxTier; tier++) {
      const tierItems = SHOP_ITEMS_BY_TIER[tier] || [];
      items.push(...tierItems);
    }

    return items;
  }

  private applyShopItem(playerData: JackpotPlayerData, item: ShopItem): void {
    switch (item.type) {
      case 'symbol':
        if (item.symbol) {
          addSymbol(playerData.slotMachine, item.symbol);
        }
        break;

      case 'remove':
        if (item.id === 'skull_removal') {
          removeAllOfType(playerData.slotMachine, 'skull');
        }
        break;

      case 'upgrade':
        upgradeAllSymbols(playerData.slotMachine);
        break;

      case 'item':
        if (item.itemEffect === 'heal_potion' && item.itemValue) {
          playerData.health = Math.min(
            playerData.maxHealth,
            playerData.health + item.itemValue
          );
        }
        break;
    }
  }

  // ============================================================================
  // GAME END
  // ============================================================================

  private endGame(room: Room, victory: boolean, reason: string): void {
    const gameState = room.gameState.data as JackpotGameState;

    this.clearRoomTimers(room.code);

    gameState.phase = victory ? 'victory' : 'defeat';

    const stats = Array.from(room.players.values()).map(p => {
      const pd = p.gameData as JackpotPlayerData;
      return {
        playerId: p.id,
        playerName: p.name,
        damageDealt: pd?.damageDealt || 0,
        healingDone: pd?.healingDone || 0,
        criticalHits: pd?.criticalHits || 0,
        selfDamage: pd?.selfDamage || 0,
        goldEarned: pd?.gold || 0
      };
    }).sort((a, b) => b.damageDealt - a.damageDealt);

    this.addLogEntry(room, null, victory ? 'victory' : 'defeat', reason);

    if (this.io) {
      const namespace = this.io.of(this.namespace);
      namespace.to(room.code).emit(victory ? 'game:victory' : 'game:defeat', {
        reason,
        stats,
        bossesDefeated: gameState.bossesDefeated
      });
    }

    this.broadcastRoomState(room);
    console.log(`[${this.name}] Game ended in room ${room.code}: ${reason}`);
  }

  private resetGame(room: Room): void {
    const settings = room.settings.gameSpecific as JackpotGameSettings;

    this.clearRoomTimers(room.code);

    // Reset game state
    room.gameState.data = {
      phase: 'lobby',
      boss: null,
      bossesDefeated: 0,
      currentRound: 0,
      shopTimeRemaining: 0,
      shopItems: [],
      battleLog: []
    } as JackpotGameState;

    room.gameState.phase = 'lobby';

    // Reset player data
    room.players.forEach(p => {
      p.gameData = {
        slotMachine: createSlotMachine(),
        health: settings.startingHealth,
        maxHealth: settings.startingHealth,
        gold: settings.startingGold,
        buffs: [],
        debuffs: [],
        damageDealt: 0,
        healingDone: 0,
        criticalHits: 0,
        selfDamage: 0,
        isReady: false
      } as JackpotPlayerData;
    });
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private broadcastRoomState(room: Room): void {
    if (!this.io) return;

    const namespace = this.io.of(this.namespace);
    room.players.forEach(player => {
      const serialized = this.serializeRoom(room, player.socketId);
      namespace.to(player.socketId).emit('roomStateUpdated', serialized);
    });
  }

  private mapPhaseToClientState(phase: GamePhase): string {
    switch (phase) {
      case 'lobby': return 'lobby';  // Client expects 'lobby' for LobbyPage routing
      case 'shop':
      case 'battle': return 'PLAYING';
      case 'victory':
      case 'defeat': return 'GAME_ENDED';
      default: return 'UNKNOWN';
    }
  }

  private getPlayerBySocket(room: Room, socketId: string): Player | undefined {
    return Array.from(room.players.values()).find(p => p.socketId === socketId);
  }

  private getConnectedPlayers(room: Room): Player[] {
    return Array.from(room.players.values()).filter(p => p.connected);
  }

  private addLogEntry(
    room: Room,
    playerId: string | null,
    type: BattleLogEntry['type'],
    message: string,
    value?: number
  ): void {
    const gameState = room.gameState.data as JackpotGameState;
    const player = playerId
      ? Array.from(room.players.values()).find(p => p.id === playerId)
      : null;

    gameState.battleLog.push({
      timestamp: Date.now(),
      playerId,
      playerName: player?.name,
      type,
      message,
      value
    });

    // Keep last 100 entries
    if (gameState.battleLog.length > 100) {
      gameState.battleLog = gameState.battleLog.slice(-100);
    }
  }

  private clearTimer(key: string): void {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key)!);
      this.timers.delete(key);
    }
    if (this.intervals.has(key)) {
      clearInterval(this.intervals.get(key)!);
      this.intervals.delete(key);
    }
  }

  private clearRoomTimers(roomCode: string): void {
    this.timers.forEach((timer, key) => {
      if (key.startsWith(roomCode)) {
        clearTimeout(timer);
        this.timers.delete(key);
      }
    });

    this.intervals.forEach((interval, key) => {
      if (key.startsWith(roomCode)) {
        clearInterval(interval);
        this.intervals.delete(key);
      }
    });
  }
}

// ============================================================================
// EXPORT
// ============================================================================

export default new JackpotCrusadersPlugin();
