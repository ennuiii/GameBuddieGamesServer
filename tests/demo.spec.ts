import { test, expect } from '@playwright/test';

/**
 * Demo test to showcase ClueScale functionality
 */

test('ClueScale Demo - Create and Join Room', async ({ browser }) => {
  // Create two pages (two players)
  const player1 = await browser.newPage();
  const player2 = await browser.newPage();

  try {
    console.log('🎮 Starting ClueScale Demo Test');

    // Player 1: Navigate to ClueScale
    console.log('📱 Player 1: Opening ClueScale...');
    await player1.goto('http://localhost:5173');
    await player1.waitForLoadState('networkidle');
    await player1.waitForTimeout(1000);

    // Player 1: Enter name and create room
    console.log('✏️  Player 1: Entering name...');
    await player1.fill('input[placeholder*="name" i]', 'Alice');
    await player1.waitForTimeout(500);

    // Take screenshot of home page
    await player1.screenshot({ path: 'test-results/demo-01-home-page.png', fullPage: true });
    console.log('📸 Screenshot saved: demo-01-home-page.png');

    console.log('🏠 Player 1: Creating room...');
    const createButton = player1.locator('button:has-text("Create Room")').first();
    if (await createButton.count() === 0) {
      await player1.locator('button:has-text("Create")').first().click();
    } else {
      await createButton.click();
    }

    await player1.waitForTimeout(3000);

    // Take screenshot of lobby
    await player1.screenshot({ path: 'test-results/demo-02-lobby-created.png', fullPage: true });
    console.log('📸 Screenshot saved: demo-02-lobby-created.png');

    // Get room code
    const bodyText = await player1.textContent('body');
    const roomCodeMatch = bodyText?.match(/[A-Z0-9]{6}/);

    if (roomCodeMatch) {
      const roomCode = roomCodeMatch[0];
      console.log(`🎯 Room Code: ${roomCode}`);

      // Player 2: Navigate to ClueScale
      console.log('📱 Player 2: Opening ClueScale...');
      await player2.goto('http://localhost:5173');
      await player2.waitForLoadState('networkidle');
      await player2.waitForTimeout(1000);

      // Player 2: Enter name
      console.log('✏️  Player 2: Entering name...');
      await player2.fill('input[placeholder*="name" i]', 'Bob');
      await player2.waitForTimeout(500);

      // Player 2: Enter room code and join
      const roomCodeInput = player2.locator('input[placeholder*="code" i], input[placeholder*="room" i]');
      if (await roomCodeInput.count() > 0) {
        console.log(`🚪 Player 2: Joining room ${roomCode}...`);
        await roomCodeInput.fill(roomCode);
        await player2.waitForTimeout(500);

        await player2.screenshot({ path: 'test-results/demo-03-about-to-join.png', fullPage: true });
        console.log('📸 Screenshot saved: demo-03-about-to-join.png');

        await player2.click('button:has-text("Join")');
        await player2.waitForTimeout(3000);

        // Take screenshots of both players
        await player1.screenshot({ path: 'test-results/demo-04-player1-after-join.png', fullPage: true });
        await player2.screenshot({ path: 'test-results/demo-05-player2-after-join.png', fullPage: true });
        console.log('📸 Screenshot saved: demo-04-player1-after-join.png');
        console.log('📸 Screenshot saved: demo-05-player2-after-join.png');

        // Check both players see each other
        const player1Text = await player1.textContent('body');
        const player2Text = await player2.textContent('body');

        console.log('✅ Player 1 can see:', player1Text?.includes('Bob') ? 'Bob ✓' : 'Bob ✗');
        console.log('✅ Player 2 can see:', player2Text?.includes('Alice') ? 'Alice ✓' : 'Alice ✗');

        expect(player1Text).toContain('Bob');
        expect(player2Text).toContain('Alice');

        console.log('🎉 Success! Both players in the room!');
      }
    }

    await player1.waitForTimeout(2000);

  } finally {
    await player1.close();
    await player2.close();
  }
});
