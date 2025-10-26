import { test, expect } from '@playwright/test';
import axios from 'axios';

/**
 * Unified Server Health Tests
 * Tests the server API endpoints and health checks
 */

test.describe('Unified Server Health', () => {

  test('should respond to health check endpoint', async () => {
    const response = await axios.get('http://localhost:3001/health');

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('status', 'healthy');
    expect(response.data).toHaveProperty('games');
    expect(response.data.games).toContain('clue-scale');
  });

  test('should respond to stats endpoint', async () => {
    const response = await axios.get('http://localhost:3001/api/stats');

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('server');
    expect(response.data).toHaveProperty('rooms');
    expect(response.data).toHaveProperty('sessions');
    expect(response.data).toHaveProperty('games');
  });

  test('should have ClueScale registered', async () => {
    const response = await axios.get('http://localhost:3001/api/stats');

    const gamesArray = response.data.games.games;
    const clueScale = gamesArray.find((g: any) => g.id === 'clue-scale');

    expect(clueScale).toBeDefined();
    expect(clueScale.namespace).toBe('/clue');
    expect(clueScale.basePath).toBe('/clue');
  });

  test('should have SUSD registered', async () => {
    const response = await axios.get('http://localhost:3001/api/stats');

    const gamesArray = response.data.games.games;
    const susd = gamesArray.find((g: any) => g.id === 'susd');

    expect(susd).toBeDefined();
    expect(susd.namespace).toBe('/susd');
    expect(susd.basePath).toBe('/susd');
  });

  test('should handle CORS correctly', async () => {
    const response = await axios.get('http://localhost:3001/health', {
      headers: {
        'Origin': 'http://localhost:5173'
      }
    });

    expect(response.headers['access-control-allow-origin']).toBeDefined();
  });
});

test.describe('ClueScale Game Endpoint', () => {

  test('should have ClueScale stats available', async () => {
    const response = await axios.get('http://localhost:3001/api/stats/clue-scale');

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('game');
    expect(response.data.game.id).toBe('clue-scale');
    expect(response.data).toHaveProperty('rooms');
  });
});
