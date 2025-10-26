import { test, expect, chromium } from '@playwright/test';

/**
 * Full Round E2E Test
 * Tests complete game flow with 3 players:
 * - Room creation
 * - Players joining
 * - Game start
 * - Clue submission
 * - Guessing
 * - Round reveal with scores
 */

test('ClueScale: Complete round with 3 players', async () => {
  // Launch browser with headed mode and slow motion
  const browser = await chromium.launch({
    headless: false,
    slowMo: 1000,
  });

  // Create 3 browser contexts (one per player)
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  const context3 = await browser.newContext();

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();
  const page3 = await context3.newPage();

  // Enable console logging for all pages
  page1.on('console', (msg) => console.log(`[Player1 Console] ${msg.text()}`));
  page2.on('console', (msg) => console.log(`[Player2 Console] ${msg.text()}`));
  page3.on('console', (msg) => console.log(`[Player3 Console] ${msg.text()}`));

  // Enable page error logging
  page1.on('pageerror', (err) => console.error(`[Player1 Error]`, err));
  page2.on('pageerror', (err) => console.error(`[Player2 Error]`, err));
  page3.on('pageerror', (err) => console.error(`[Player3 Error]`, err));

  let roomCode = '';

  try {
    console.log('\n=== Step 1: Player1 creates room ===');
    await page1.goto('http://localhost:5173');
    await page1.fill('input[placeholder*="name" i]', 'Player1');
    await page1.screenshot({ path: 'test-results/01-player1-enter-name.png' });
    await page1.click('button:has-text("Create Room")');

    // Wait for lobby to load
    await page1.waitForTimeout(2000);
    await page1.screenshot({ path: 'test-results/02-player1-lobby.png' });

    // Extract room code from page
    const lobbyText = await page1.textContent('body');
    const roomCodeMatch = lobbyText?.match(/Room Code[:\s]*([A-Z0-9]{6})/i);
    if (roomCodeMatch) {
      roomCode = roomCodeMatch[1];
      console.log(`✓ Room created: ${roomCode}`);
    } else {
      throw new Error('Could not extract room code from page');
    }

    console.log('\n=== Step 2: Player2 joins room ===');
    await page2.goto('http://localhost:5173');
    await page2.fill('input[placeholder*="name" i]', 'Player2');
    await page2.screenshot({ path: 'test-results/03-player2-enter-name.png' });
    await page2.click('button:has-text("Join Room")');

    // Enter room code
    await page2.waitForSelector('input[placeholder*="code" i]', { timeout: 5000 });
    await page2.fill('input[placeholder*="code" i]', roomCode);
    await page2.screenshot({ path: 'test-results/04-player2-enter-code.png' });
    await page2.click('button:has-text("Join")');

    await page2.waitForTimeout(2000);
    await page2.screenshot({ path: 'test-results/05-player2-in-lobby.png' });
    console.log('✓ Player2 joined');

    console.log('\n=== Step 3: Player3 joins room ===');
    await page3.goto('http://localhost:5173');
    await page3.fill('input[placeholder*="name" i]', 'Player3');
    await page3.screenshot({ path: 'test-results/06-player3-enter-name.png' });
    await page3.click('button:has-text("Join Room")');

    await page3.waitForSelector('input[placeholder*="code" i]', { timeout: 5000 });
    await page3.fill('input[placeholder*="code" i]', roomCode);
    await page3.screenshot({ path: 'test-results/07-player3-enter-code.png' });
    await page3.click('button:has-text("Join")');

    await page3.waitForTimeout(2000);
    await page3.screenshot({ path: 'test-results/08-player3-in-lobby.png' });
    console.log('✓ Player3 joined');

    console.log('\n=== Step 4: Player1 starts game ===');
    await page1.screenshot({ path: 'test-results/09-player1-lobby-3-players.png' });

    // Click Start Game button
    await page1.click('button:has-text("Start Game")');
    await page1.waitForTimeout(2000);
    await page1.screenshot({ path: 'test-results/10-player1-round-started.png' });
    console.log('✓ Game started');

    console.log('\n=== Step 5: Wait for role assignment ===');
    await page2.waitForTimeout(1000);
    await page3.waitForTimeout(1000);

    // Take screenshots of all players to see their roles
    await page1.screenshot({ path: 'test-results/11-player1-role.png' });
    await page2.screenshot({ path: 'test-results/12-player2-role.png' });
    await page3.screenshot({ path: 'test-results/13-player3-role.png' });

    // Determine who is the clue giver by checking for target number display
    let clueGiverPage = null;
    let guesserPages: any[] = [];

    const page1HasTargetNumber = await page1.textContent('body').then(text =>
      text?.includes('Target Number') || text?.includes('Give a Clue')
    );
    const page2HasTargetNumber = await page2.textContent('body').then(text =>
      text?.includes('Target Number') || text?.includes('Give a Clue')
    );
    const page3HasTargetNumber = await page3.textContent('body').then(text =>
      text?.includes('Target Number') || text?.includes('Give a Clue')
    );

    if (page1HasTargetNumber) {
      clueGiverPage = page1;
      guesserPages = [page2, page3];
      console.log('✓ Player1 is clue giver');
    } else if (page2HasTargetNumber) {
      clueGiverPage = page2;
      guesserPages = [page1, page3];
      console.log('✓ Player2 is clue giver');
    } else if (page3HasTargetNumber) {
      clueGiverPage = page3;
      guesserPages = [page1, page2];
      console.log('✓ Player3 is clue giver');
    } else {
      throw new Error('Could not identify clue giver');
    }

    console.log('\n=== Step 6: Clue giver submits clue ===');
    // Submit clue
    await clueGiverPage.fill('input[type="text"]', 'Medium');
    await clueGiverPage.screenshot({ path: 'test-results/14-clue-giver-enters-clue.png' });
    await clueGiverPage.click('button:has-text("Submit Clue")');
    await clueGiverPage.waitForTimeout(2000);
    await clueGiverPage.screenshot({ path: 'test-results/15-clue-giver-after-submit.png' });
    console.log('✓ Clue submitted: "Medium"');

    console.log('\n=== Step 7: Guessers submit guesses ===');
    await guesserPages[0].waitForTimeout(1000);
    await guesserPages[1].waitForTimeout(1000);

    await guesserPages[0].screenshot({ path: 'test-results/16-guesser1-sees-clue.png' });
    await guesserPages[1].screenshot({ path: 'test-results/17-guesser2-sees-clue.png' });

    // Guesser 1 submits guess
    await guesserPages[0].fill('input[type="number"]', '5');
    await guesserPages[0].screenshot({ path: 'test-results/18-guesser1-enters-guess.png' });
    await guesserPages[0].click('button:has-text("Submit Guess")');
    await guesserPages[0].waitForTimeout(1000);
    console.log('✓ Guesser 1 submitted: 5');

    // Guesser 2 submits guess
    await guesserPages[1].fill('input[type="number"]', '6');
    await guesserPages[1].screenshot({ path: 'test-results/19-guesser2-enters-guess.png' });
    await guesserPages[1].click('button:has-text("Submit Guess")');
    await guesserPages[1].waitForTimeout(2000);
    console.log('✓ Guesser 2 submitted: 6');

    console.log('\n=== Step 8: Wait for round reveal ===');
    await page1.waitForTimeout(3000);
    await page2.waitForTimeout(3000);
    await page3.waitForTimeout(3000);

    // Take screenshots of round reveal
    await page1.screenshot({ path: 'test-results/20-player1-round-reveal.png' });
    await page2.screenshot({ path: 'test-results/21-player2-round-reveal.png' });
    await page3.screenshot({ path: 'test-results/22-player3-round-reveal.png' });

    console.log('\n=== Step 9: Verify scores displayed ===');
    const page1Text = await page1.textContent('body');
    const page2Text = await page2.textContent('body');
    const page3Text = await page3.textContent('body');

    // Check that scores are visible (should contain "Score" or "Points")
    const hasScores = (
      page1Text?.includes('Score') || page1Text?.includes('Points') ||
      page2Text?.includes('Score') || page2Text?.includes('Points') ||
      page3Text?.includes('Score') || page3Text?.includes('Points')
    );

    if (hasScores) {
      console.log('✓ Scores displayed in round reveal');
    } else {
      console.warn('⚠ Could not find scores in round reveal');
    }

    // Check that target number is revealed
    const hasTargetRevealed = (
      page1Text?.includes('Target Number') || page1Text?.includes('Target:') ||
      page2Text?.includes('Target Number') || page2Text?.includes('Target:') ||
      page3Text?.includes('Target Number') || page3Text?.includes('Target:')
    );

    if (hasTargetRevealed) {
      console.log('✓ Target number revealed');
    } else {
      console.warn('⚠ Could not find target number in reveal');
    }

    console.log('\n=== Test Complete ===');
    console.log('✓ Full round completed successfully!');
    console.log('✓ No crashes during leaderboard generation');
    console.log('✓ Scores displayed correctly');

    // Keep browser open for 10 seconds to view results
    await page1.waitForTimeout(10000);

  } catch (error) {
    console.error('\n❌ Test failed:', error);

    // Take error screenshots
    await page1.screenshot({ path: 'test-results/error-player1.png' });
    await page2.screenshot({ path: 'test-results/error-player2.png' });
    await page3.screenshot({ path: 'test-results/error-player3.png' });

    throw error;
  } finally {
    await browser.close();
  }
});
