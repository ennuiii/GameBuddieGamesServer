import { GAME_CONFIG, TILE, DIRECTION, Direction, CURSE_TYPE } from '../shared/constants.js';
import { BombData, ExplosionData, BombermanGameState, BombermanPlayerData } from '../types.js';
import { MapGenerator } from './MapGenerator.js';
import { CurseManager } from './CurseManager.js';
import type { Room, Player } from '../../../core/types/core.js';

export class BombManager {
  /**
   * Place a bomb at the player's current position
   */
  static placeBomb(
    room: Room,
    player: Player,
    gameState: BombermanGameState
  ): BombData | null {
    const playerData = player.gameData as BombermanPlayerData;

    // Check if player is stunned
    if (playerData.stunnedUntil > Date.now()) return null;

    // Check if cursed with NO_BOMBS
    if (!CurseManager.canPlaceBomb(player)) return null;

    // Check if player has bombs available
    if (playerData.bombsPlaced >= playerData.maxBombs) return null;

    // Check if there's already a bomb at this position
    const existingBomb = this.findBombAt(gameState, playerData.gridX, playerData.gridY);
    if (existingBomb) return null;

    // Create bomb
    const bombId = `bomb_${gameState.bombIdCounter++}`;
    const bombTimer = CurseManager.getBombTimer(player); // May be shortened by SHORT_FUSE curse
    const bomb: BombData = {
      id: bombId,
      ownerId: player.id,
      gridX: playerData.gridX,
      gridY: playerData.gridY,
      range: playerData.fireRange,
      timer: bombTimer,
      isMoving: false,
      moveDir: DIRECTION.NONE,
      isFlying: false,
      flyDir: DIRECTION.NONE,
      targetX: playerData.gridX,
      targetY: playerData.gridY,
      placedAt: Date.now(),
      lastSlideTime: 0,
      lastFlyTime: 0,
      isPiercing: playerData.hasPierce, // Pierce bombs go through soft blocks
      isPunched: false,
    };

    gameState.bombs.set(bombId, bomb);
    playerData.bombsPlaced += 1;

    return bomb;
  }

  /**
   * Find a bomb at the given position
   */
  static findBombAt(gameState: BombermanGameState, x: number, y: number): BombData | null {
    for (const bomb of gameState.bombs.values()) {
      if (bomb.gridX === x && bomb.gridY === y) {
        return bomb;
      }
    }
    return null;
  }

  /**
   * Update all bombs (timers)
   */
  static updateBombs(
    deltaTime: number,
    room: Room,
    gameState: BombermanGameState,
    onExplosion: (bomb: BombData) => void
  ): void {
    const bombsToExplode: string[] = [];

    gameState.bombs.forEach((bomb, bombId) => {
      bomb.timer -= deltaTime;
      if (bomb.timer <= 0) {
        bombsToExplode.push(bombId);
      }
    });

    // Explode bombs
    for (const bombId of bombsToExplode) {
      const bomb = gameState.bombs.get(bombId);
      if (bomb) {
        this.explodeBomb(bomb, room, gameState);
        gameState.bombs.delete(bombId);

        // Return bomb to owner
        const owner = room.players.get(bomb.ownerId);
        if (owner) {
          const ownerData = owner.gameData as BombermanPlayerData;
          ownerData.bombsPlaced = Math.max(0, ownerData.bombsPlaced - 1);
        }

        onExplosion(bomb);
      }
    }
  }

  /**
   * Explode a bomb - create explosions and destroy blocks
   */
  static explodeBomb(bomb: BombData, room: Room, gameState: BombermanGameState): void {
    const { gridX, gridY, range } = bomb;

    // Create explosion at bomb center
    this.createExplosion(gridX, gridY, gameState);

    // Spread in 4 directions
    const directions = [
      { dx: 0, dy: -1 }, // Up
      { dx: 0, dy: 1 },  // Down
      { dx: -1, dy: 0 }, // Left
      { dx: 1, dy: 0 },  // Right
    ];

    for (const dir of directions) {
      for (let i = 1; i <= range; i++) {
        const x = gridX + dir.dx * i;
        const y = gridY + dir.dy * i;

        const tile = this.getTile(gameState, x, y);

        // Stop at hard walls
        if (tile === TILE.HARD_WALL) break;

        // Create explosion
        this.createExplosion(x, y, gameState);

        // Destroy soft blocks
        if (tile === TILE.SOFT_BLOCK) {
          const powerUp = MapGenerator.getRandomPowerUp();
          this.setTile(gameState, x, y, powerUp ?? TILE.EMPTY);
          // Pierce bombs continue through soft blocks, normal bombs stop
          if (!bomb.isPiercing) {
            break; // Stop spreading in this direction
          }
          // Pierce bomb: continue spreading after destroying the block
        }

        // Check for chain reaction with other bombs
        gameState.bombs.forEach((otherBomb) => {
          if (otherBomb.gridX === x && otherBomb.gridY === y) {
            // Trigger chain explosion
            otherBomb.timer = 0;
          }
        });
      }
    }
  }

  /**
   * Create an explosion at the given position
   */
  static createExplosion(x: number, y: number, gameState: BombermanGameState): void {
    // Don't create explosions on hard walls
    if (this.getTile(gameState, x, y) === TILE.HARD_WALL) return;

    const explosionId = `exp_${gameState.explosionIdCounter++}`;
    const explosion: ExplosionData = {
      id: explosionId,
      gridX: x,
      gridY: y,
      timer: GAME_CONFIG.EXPLOSION_DURATION,
      createdAt: Date.now(),
    };

    gameState.explosions.set(explosionId, explosion);
  }

  /**
   * Update all explosions (timers)
   */
  static updateExplosions(deltaTime: number, gameState: BombermanGameState): void {
    const explosionsToRemove: string[] = [];

    gameState.explosions.forEach((explosion, id) => {
      explosion.timer -= deltaTime;
      if (explosion.timer <= 0) {
        explosionsToRemove.push(id);
      }
    });

    for (const id of explosionsToRemove) {
      gameState.explosions.delete(id);
    }
  }

  /**
   * Kick a bomb in a direction
   */
  static kickBomb(bomb: BombData, direction: Direction): void {
    if (bomb.isMoving || bomb.isFlying) return; // Already moving

    bomb.isMoving = true;
    bomb.moveDir = direction;
    bomb.lastSlideTime = Date.now();
  }

  /**
   * Update moving bombs (kicked)
   */
  static updateMovingBombs(
    gameState: BombermanGameState,
    room: Room,
    onPlayerHit: (player: Player) => void
  ): void {
    const now = Date.now();

    gameState.bombs.forEach((bomb) => {
      if (!bomb.isMoving) return;

      // Check if it's time to slide
      if (now - bomb.lastSlideTime < GAME_CONFIG.BOMB_SLIDE_SPEED) return;

      // Calculate next position
      let nextX = bomb.gridX;
      let nextY = bomb.gridY;

      switch (bomb.moveDir) {
        case DIRECTION.UP:
          nextY -= 1;
          break;
        case DIRECTION.DOWN:
          nextY += 1;
          break;
        case DIRECTION.LEFT:
          nextX -= 1;
          break;
        case DIRECTION.RIGHT:
          nextX += 1;
          break;
      }

      // Check if can slide to next position
      if (this.canBombSlideTo(gameState, nextX, nextY)) {
        bomb.gridX = nextX;
        bomb.gridY = nextY;
        bomb.lastSlideTime = now;

        // Check if bomb hits a player (stun them!)
        this.checkBombHitsPlayer(bomb, room, onPlayerHit);
      } else {
        // Stop moving
        bomb.isMoving = false;
        bomb.moveDir = DIRECTION.NONE;
      }
    });
  }

  /**
   * Check if a bomb can slide to a position
   */
  static canBombSlideTo(gameState: BombermanGameState, x: number, y: number): boolean {
    // Check bounds
    if (x < 0 || x >= GAME_CONFIG.GRID_WIDTH || y < 0 || y >= GAME_CONFIG.GRID_HEIGHT) {
      return false;
    }

    const tile = this.getTile(gameState, x, y);

    // Stop at walls and soft blocks
    if (tile === TILE.HARD_WALL || tile === TILE.SOFT_BLOCK) {
      return false;
    }

    // Stop at other bombs
    const bombAtPos = this.findBombAt(gameState, x, y);
    if (bombAtPos) {
      return false;
    }

    return true;
  }

  /**
   * Check if a bomb hits a player when moving
   */
  private static checkBombHitsPlayer(
    bomb: BombData,
    room: Room,
    onPlayerHit: (player: Player) => void
  ): void {
    room.players.forEach((player) => {
      const playerData = player.gameData as BombermanPlayerData;
      if (!playerData.alive) return;

      if (playerData.gridX === bomb.gridX && playerData.gridY === bomb.gridY) {
        onPlayerHit(player);
        // Stop the bomb when it hits a player
        bomb.isMoving = false;
        bomb.moveDir = DIRECTION.NONE;
      }
    });
  }

  /**
   * Throw a bomb - flies over walls AND boxes, wraps around borders
   */
  static throwBomb(
    bomb: BombData,
    player: Player,
    gameState: BombermanGameState
  ): boolean {
    const playerData = player.gameData as BombermanPlayerData;

    // Don't throw if already flying or moving
    if (bomb.isFlying || bomb.isMoving) return false;

    // Calculate throw direction
    let dx = 0, dy = 0;
    switch (playerData.facingDir) {
      case DIRECTION.UP:
        dy = -1;
        break;
      case DIRECTION.DOWN:
        dy = 1;
        break;
      case DIRECTION.LEFT:
        dx = -1;
        break;
      case DIRECTION.RIGHT:
        dx = 1;
        break;
      default:
        return false; // No direction, can't throw
    }

    // Find landing position - bomb flies over EVERYTHING (walls and boxes) until empty tile
    let landX = playerData.gridX;
    let landY = playerData.gridY;
    let foundLanding = false;

    // Search up to a full map wrap (enough to circle the entire map)
    const maxSearch = Math.max(GAME_CONFIG.GRID_WIDTH, GAME_CONFIG.GRID_HEIGHT) * 2;

    for (let i = 1; i <= maxSearch; i++) {
      // Calculate position WITH wrapping
      let checkX = playerData.gridX + dx * i;
      let checkY = playerData.gridY + dy * i;

      // Wrap around borders (modulo that handles negatives)
      checkX = ((checkX % GAME_CONFIG.GRID_WIDTH) + GAME_CONFIG.GRID_WIDTH) % GAME_CONFIG.GRID_WIDTH;
      checkY = ((checkY % GAME_CONFIG.GRID_HEIGHT) + GAME_CONFIG.GRID_HEIGHT) % GAME_CONFIG.GRID_HEIGHT;

      // Stop if we've wrapped back to start position (no valid landing found)
      if (i > 1 && checkX === playerData.gridX && checkY === playerData.gridY) {
        break;
      }

      const tile = this.getTile(gameState, checkX, checkY);

      // FLY OVER hard walls AND soft blocks - continue searching
      if (tile === TILE.HARD_WALL || tile === TILE.SOFT_BLOCK) {
        continue;
      }

      // Check if there's a bomb at this position
      const bombAtPos = this.findBombAt(gameState, checkX, checkY);
      if (bombAtPos) {
        continue; // Fly over other bombs too
      }

      // Check if this tile is empty (can land here)
      const isEmptyTile = tile === TILE.EMPTY ||
                          tile === TILE.POWERUP_BOMB ||
                          tile === TILE.POWERUP_FIRE ||
                          tile === TILE.POWERUP_SPEED ||
                          tile === TILE.POWERUP_KICK ||
                          tile === TILE.POWERUP_THROW;

      if (isEmptyTile) {
        // Found valid landing spot!
        landX = checkX;
        landY = checkY;
        foundLanding = true;
        break;
      }
    }

    // If no landing found or same position, don't throw
    if (!foundLanding || (landX === playerData.gridX && landY === playerData.gridY)) {
      return false;
    }

    // Start flying
    bomb.isFlying = true;
    bomb.flyDir = playerData.facingDir;
    bomb.targetX = landX;
    bomb.targetY = landY;
    bomb.lastFlyTime = Date.now();

    return true;
  }

  /**
   * Punch a bomb - instantly knock it 3 tiles in facing direction
   * Unlike throw, punch targets a bomb IN FRONT of the player, not under them
   */
  static punchBomb(
    player: Player,
    gameState: BombermanGameState,
    room: Room,
    onPlayerHit: (player: Player) => void
  ): boolean {
    const playerData = player.gameData as BombermanPlayerData;

    // Check if player has punch ability
    if (!playerData.hasPunch) return false;

    // Calculate position in front of player
    let frontX = playerData.gridX;
    let frontY = playerData.gridY;
    let dx = 0, dy = 0;

    switch (playerData.facingDir) {
      case DIRECTION.UP:
        frontY -= 1;
        dy = -1;
        break;
      case DIRECTION.DOWN:
        frontY += 1;
        dy = 1;
        break;
      case DIRECTION.LEFT:
        frontX -= 1;
        dx = -1;
        break;
      case DIRECTION.RIGHT:
        frontX += 1;
        dx = 1;
        break;
      default:
        return false;
    }

    // Check if there's a bomb in front
    const bomb = this.findBombAt(gameState, frontX, frontY);
    if (!bomb) return false;

    // Don't punch if bomb is already moving
    if (bomb.isMoving || bomb.isFlying) return false;

    // Calculate landing position (up to PUNCH_DISTANCE tiles)
    let targetX = frontX;
    let targetY = frontY;

    for (let i = 1; i <= GAME_CONFIG.PUNCH_DISTANCE; i++) {
      const nextX = frontX + dx * i;
      const nextY = frontY + dy * i;

      // Check bounds
      if (nextX < 0 || nextX >= GAME_CONFIG.GRID_WIDTH ||
          nextY < 0 || nextY >= GAME_CONFIG.GRID_HEIGHT) {
        break;
      }

      const tile = this.getTile(gameState, nextX, nextY);

      // Stop at walls and soft blocks
      if (tile === TILE.HARD_WALL || tile === TILE.SOFT_BLOCK) break;

      // Stop at other bombs
      const bombAtPos = this.findBombAt(gameState, nextX, nextY);
      if (bombAtPos) break;

      // Check if this position has a player - stun them!
      let hitPlayer = false;
      room.players.forEach((p) => {
        const pd = p.gameData as BombermanPlayerData;
        if (pd.alive && pd.gridX === nextX && pd.gridY === nextY) {
          onPlayerHit(p);
          hitPlayer = true;
        }
      });

      targetX = nextX;
      targetY = nextY;

      // Stop if we hit a player
      if (hitPlayer) break;
    }

    // Move bomb instantly to target position
    bomb.gridX = targetX;
    bomb.gridY = targetY;
    bomb.isPunched = true; // Flag for client arc animation

    return true;
  }

  /**
   * Update flying bombs (thrown)
   */
  static updateFlyingBombs(
    gameState: BombermanGameState,
    room: Room,
    onPlayerHit: (player: Player, bomb: BombData) => void
  ): void {
    const now = Date.now();

    gameState.bombs.forEach((bomb) => {
      if (!bomb.isFlying) return;

      // Check if it's time to move to next tile
      if (now - bomb.lastFlyTime < GAME_CONFIG.BOMB_FLY_SPEED) return;

      // Calculate direction offset
      let dx = 0, dy = 0;
      switch (bomb.flyDir) {
        case DIRECTION.UP:
          dy = -1;
          break;
        case DIRECTION.DOWN:
          dy = 1;
          break;
        case DIRECTION.LEFT:
          dx = -1;
          break;
        case DIRECTION.RIGHT:
          dx = 1;
          break;
      }

      // Move to next tile WITH WRAPPING
      let nextX = bomb.gridX + dx;
      let nextY = bomb.gridY + dy;

      // Wrap around borders (modulo that handles negatives)
      nextX = ((nextX % GAME_CONFIG.GRID_WIDTH) + GAME_CONFIG.GRID_WIDTH) % GAME_CONFIG.GRID_WIDTH;
      nextY = ((nextY % GAME_CONFIG.GRID_HEIGHT) + GAME_CONFIG.GRID_HEIGHT) % GAME_CONFIG.GRID_HEIGHT;

      bomb.gridX = nextX;
      bomb.gridY = nextY;
      bomb.lastFlyTime = now;

      // Check if we've reached the target
      if (bomb.gridX === bomb.targetX && bomb.gridY === bomb.targetY) {
        bomb.isFlying = false;
        bomb.flyDir = DIRECTION.NONE;

        // Check if bomb lands on a player (stun them!)
        room.players.forEach((player) => {
          const playerData = player.gameData as BombermanPlayerData;
          if (!playerData.alive) return;
          if (player.id === bomb.ownerId) return; // Don't stun thrower
          if (playerData.gridX === bomb.gridX && playerData.gridY === bomb.gridY) {
            onPlayerHit(player, bomb);
          }
        });
      }
    });
  }

  // Helper methods for tile access
  private static getTile(gameState: BombermanGameState, x: number, y: number): number {
    if (x < 0 || x >= GAME_CONFIG.GRID_WIDTH || y < 0 || y >= GAME_CONFIG.GRID_HEIGHT) {
      return TILE.HARD_WALL;
    }
    return gameState.tiles[y * GAME_CONFIG.GRID_WIDTH + x];
  }

  private static setTile(gameState: BombermanGameState, x: number, y: number, value: number): void {
    if (x >= 0 && x < GAME_CONFIG.GRID_WIDTH && y >= 0 && y < GAME_CONFIG.GRID_HEIGHT) {
      gameState.tiles[y * GAME_CONFIG.GRID_WIDTH + x] = value;
    }
  }
}
