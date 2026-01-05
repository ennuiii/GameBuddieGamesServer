/**
 * GameLoop - Manages a 60Hz server tick for game updates
 */
export class GameLoop {
  private intervalId: NodeJS.Timeout | null = null;
  private lastTime: number = 0;
  private isRunning: boolean = false;

  /**
   * Start the game loop
   * @param onTick Callback called every tick with delta time in ms
   * @param tickRate Ticks per second (default 60)
   */
  start(onTick: (deltaMs: number) => void, tickRate: number = 60): void {
    if (this.isRunning) {
      console.warn('GameLoop already running');
      return;
    }

    const interval = 1000 / tickRate;
    this.lastTime = Date.now();
    this.isRunning = true;

    this.intervalId = setInterval(() => {
      const now = Date.now();
      const delta = now - this.lastTime;
      this.lastTime = now;

      try {
        onTick(delta);
      } catch (error) {
        console.error('Error in game loop tick:', error);
      }
    }, interval);
  }

  /**
   * Stop the game loop
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }

  /**
   * Check if the loop is running
   */
  get running(): boolean {
    return this.isRunning;
  }
}
