import { Ati } from './src/automation/ati';

async function main() {
  const ati = new Ati();

  // Make the wait loop check the screen every 50ms instead of 1s
  // This makes the automation run AS FAST AS POSSIBLE
  ati.set('WAITSLEEP', 0.05);

  const ITERATIONS = 10;
  const USER = 'HERC01';
  const PASS = 'CUL8TR';

  console.log(`🚀 Starting stress test: ${ITERATIONS} Login/Logout cycles on ONE session\n`);
  console.time('Total Time');

  try {
    process.stdout.write('Connecting to mainframe... ');
    await ati.connectSession('TK4', {
      host: '127.0.0.1',
      port: 3270,
      useTn3270e: true,
      terminalType: 'IBM-3278-2-E',
    });
    
    // Wait for splash and clear it (only needed once per session)
    await ati.wait(10, () => ati.scrhas('Hercules Version'));
    await ati.send('[enter]');
    await ati.wait(10, () => !ati.scrhas('Hercules Version'));
    process.stdout.write('Connected.\n\n');

    for (let i = 1; i <= ITERATIONS; i++) {
      process.stdout.write(`Cycle ${i.toString().padStart(2, ' ')}/${ITERATIONS}: `);
      
      // Wait for Logon prompt (we should be dropped back here after LOGOFF)
      await ati.wait(10, () => ati.scrhas('Logon ===>'));

      // Send Logon command
      process.stdout.write('Logging in... ');
      await ati.send('[clear]');
      await ati.wait(2, () => ati.keyLock === false);
      await ati.send(`L ${USER}[enter]`);

      // Enter password
      let rc = await ati.wait(10, () => ati.scrhas('PASSWORD'));
      if (rc === 0) throw new Error('Timeout waiting for password prompt');
      await ati.send(`${PASS}[enter]`);

      // Clear the two *** prompts (Welcome + Fortune Cookie)
      rc = await ati.wait(10, () => ati.scrhas('Welcome to the TSO system'));
      if (rc === 0) throw new Error('Timeout waiting for Welcome Banner');
      await ati.send('[enter]');
      
      rc = await ati.wait(10, () => ati.scrhas('***'));
      if (rc === 0) throw new Error('Timeout waiting for Fortune cookie');
      await ati.send('[enter]');

      // Wait for Main Menu
      rc = await ati.wait(10, () => ati.scrhas('Option ===>'));
      if (rc === 0) throw new Error('Timeout waiting for ISPF Menu');
      process.stdout.write('Logged In! Logging out... ');

      // Exit ISPF
      await ati.send('X[enter]');
      await ati.wait(10, () => ati.scrhas('READY'));

      // Logoff TSO
      await ati.send('LOGOFF[enter]');
      
      process.stdout.write('Done. ✅\n');
    }

  } catch (err) {
    process.stdout.write('FAILED ❌\n');
    console.error(`\nError:`, err);
    
    // Dump the screen on error to see what went wrong
    const tnz = ati.getTnz();
    if (tnz) {
      console.log('\n--- Screen at failure ---');
      console.log(tnz.scrstr(0, 0, true));
      console.log('-------------------------\n');
    }
  } finally {
    // Always drop the session at the end
    console.log('\nClosing connection...');
    ati.dropSession();
  }

  console.log('🏁 Stress test finished!');
  console.timeEnd('Total Time');
}

main().catch(console.error);
