import { chromium } from 'playwright';

(async () => {
  console.log('🎮 Starting Visual ClueScale Test');
  console.log('📱 Opening browser...');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 1000, // 1 second delay between actions
    args: ['--start-maximized']
  });

  const context = await browser.newContext({
    viewport: null
  });

  // Player 1
  const player1 = await context.newPage();

  // Capture console logs
  player1.on('console', msg => {
    console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`);
  });

  // Capture page errors
  player1.on('pageerror', error => {
    console.log(`[PAGE ERROR] ${error.message}`);
  });

  console.log('🌐 Player 1: Navigating to http://localhost:5173');
  await player1.goto('http://localhost:5173');
  await player1.waitForLoadState('networkidle');
  await player1.waitForTimeout(2000);

  console.log('✏️  Player 1: Entering name "Alice"');
  await player1.fill('input[placeholder*="name" i]', 'Alice');
  await player1.waitForTimeout(1000);

  console.log('🏠 Player 1: Clicking Create Room submit button');
  // Click the submit button (inside the form), not the mode button
  const submitButton = player1.locator('form button[type="submit"]');
  await submitButton.click();

  await player1.waitForTimeout(5000); // Wait longer for two-step creation

  // Get room code
  const bodyText = await player1.textContent('body');
  console.log('📄 Page content after room creation:');
  console.log('---');
  console.log(bodyText?.substring(0, 500)); // First 500 chars
  console.log('---');

  const roomCodeMatch = bodyText?.match(/[A-Z0-9]{6}/);

  if (roomCodeMatch) {
    const roomCode = roomCodeMatch[0];
    console.log(`🎯 Room Code: ${roomCode}`);

    // Player 2
    console.log('📱 Player 2: Opening new browser window');
    const player2 = await context.newPage();

    console.log('🌐 Player 2: Navigating to http://localhost:5173');
    await player2.goto('http://localhost:5173');
    await player2.waitForLoadState('networkidle');
    await player2.waitForTimeout(2000);

    console.log('✏️  Player 2: Entering name "Bob"');
    await player2.fill('input[placeholder*="name" i]', 'Bob');
    await player2.waitForTimeout(1000);

    // Enter room code
    const roomCodeInput = player2.locator('input[placeholder*="code" i], input[placeholder*="room" i]');
    if (await roomCodeInput.count() > 0) {
      console.log(`🚪 Player 2: Entering room code ${roomCode}`);
      await roomCodeInput.fill(roomCode);
      await player2.waitForTimeout(1000);

      console.log('🚪 Player 2: Clicking Join button');
      await player2.click('button:has-text("Join")');
      await player2.waitForTimeout(3000);

      // Check both players
      const player1Text = await player1.textContent('body');
      const player2Text = await player2.textContent('body');

      console.log('✅ Player 1 can see:', player1Text?.includes('Bob') ? 'Bob ✓' : 'Bob ✗');
      console.log('✅ Player 2 can see:', player2Text?.includes('Alice') ? 'Alice ✓' : 'Alice ✗');

      console.log('\n🎉 Test completed! Both browser windows will stay open for 30 seconds...');
      await player1.waitForTimeout(30000);
    }
  }

  await browser.close();
  console.log('✅ Done!');
})();
