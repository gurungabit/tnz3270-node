import { Ati } from './src/automation/ati';

async function main() {
  const ati = new Ati();

  // Make the wait loop check the screen every 50ms instead of 1s
  // This makes the automation run AS FAST AS POSSIBLE
  ati.set('WAITSLEEP', 0.05);

  const ITERATIONS = 10;
  const USER = 'HERC01';
  const PASS = 'CUL8TR';

  console.log(`🚀 Starting stress test: ${ITERATIONS} Login/Logout cycles\n`);
  console.time('Total Time');

  for (let i = 1; i <= ITERATIONS; i++) {
    process.stdout.write(`Cycle ${i.toString().padStart(2, ' ')}/${ITERATIONS}: `);
    
    try {
      // Connect
      process.stdout.write('Connecting... ');
      await ati.connectSession(`TK4_${i}`, {
        host: '127.0.0.1',
        port: 3270,
        useTn3270e: true,
        terminalType: 'IBM-3278-2-E',
      });

      // Wait for splash and clear it
      await ati.wait(10, () => ati.scrhas('Hercules Version'));
      await ati.send('[enter]');
      await ati.wait(10, () => !ati.scrhas('Hercules Version'));
      
      // Wait for Logon prompt
      await ati.wait(10, () => ati.scrhas('Logon ===>'));

      // Send Logon command
      process.stdout.write('Logging in... ');
      await ati.send('[clear]');
      await ati.wait(2, () => ati.keyLock === false);
      await ati.send(`L ${USER}[enter]`);

      // Enter password
      await ati.wait(10, () => ati.scrhas('PASSWORD'));
      await ati.send(`[home]${PASS}[enter]`);

      // Clear the two *** prompts (Welcome + Fortune Cookie)
      await ati.wait(10, () => ati.scrhas('Welcome to the TSO system'));
      await ati.send('[enter]');
      await ati.wait(10, () => ati.scrhas('***'));
      await ati.send('[enter]');

      // Wait for Main Menu
      await ati.wait(10, () => ati.scrhas('Option ===>'));
      process.stdout.write('Logged In! Logging out... ');

      // Exit ISPF
      await ati.send('X[enter]');
      await ati.wait(10, () => ati.scrhas('READY'));

      // Logoff TSO
      await ati.send('LOGOFF[enter]');
      await ati.wait(10, () => ati.scrhas('Logon ===>'));

      process.stdout.write('Done. ✅\n');

    } catch (err) {
      process.stdout.write('FAILED ❌\n');
      console.error(`\nError during cycle ${i}:`, err);
      
      // Dump the screen on error to see what went wrong
      const tnz = ati.getTnz();
      if (tnz) {
        console.log('\n--- Screen at failure ---');
        console.log(tnz.scrstr(0, 0, true));
        console.log('-------------------------\n');
      }
      break; // stop test on first failure
    } finally {
      // Always drop the session at the end of the cycle
      ati.dropSession();
    }
  }

  console.log('\n🏁 Stress test finished!');
  console.timeEnd('Total Time');
}

main().catch(console.error);
