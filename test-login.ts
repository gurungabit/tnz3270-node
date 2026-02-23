import { Ati } from './src/automation/ati';

async function main() {
  const ati = new Ati();

  console.log('Connecting to TK4- mainframe (127.0.0.1:3270)...');
  await ati.connectSession('TK4', {
    host: '127.0.0.1',
    port: 3270,
    useTn3270e: true,
    terminalType: 'IBM-3278-2-E',
  });

  // Turn on logging so we can see screen output
  ati.set('TRACE', 'ALL');
  
  // Create a helper to dump the screen purely for debugging visibility
  const dumpScreen = (msg: string) => {
    console.log(`\n=============================================================`);
    console.log(`[ SCREEN STATE ] ${msg}`);
    console.log(`=============================================================`);
    const tnz = ati.getTnz();
    if (tnz) {
      console.log(tnz.scrstr(0, 0, true));
    }
    console.log(`=============================================================\n`);
  };

  try {
    // 1. Wait for the Hercules Logo / Initial splash screen
    console.log('Waiting for initial connection...');
    await ati.wait(2, () => ati.scrhas('Hercules Version'));
    dumpScreen('Connected to Hercules');

    // Send an initial ENTER to get past the Hercules splash screen
    // and load the TK4- Logon prompt
    console.log('Sending initial enter to clear splash screen...');
    await ati.send('[enter]');

    // Wait until the splash screen is GONE (give it plenty of time for Hercules to spin up MVS)
    console.log('Waiting for splash screen to disappear (up to 30s)...');
    await ati.wait(30, () => !ati.scrhas('Hercules Version'));
    
    // Wait until we see Logon
    console.log('Waiting for Logon prompt (up to 30s)...');
    await ati.wait(30, () => ati.scrhas('Logon ===>'));

    // 2. We should now be on the real TSO Logon prompt screen.
    console.log('Sending Logon command...');
    await ati.send('[clear]');
    await ati.wait(2, () => ati.keyLock === false);
    
    // TSO command to login directly
    await ati.send('L HERC01[enter]');
    dumpScreen('Sent L HERC01, waiting for password prompt...');

    // 3. Wait for the actual password screen
    let rc = await ati.wait(10, () => ati.scrhas('PASSWORD'));
    if (rc === 0) throw new Error('Timeout waiting for password prompt');
    dumpScreen('Password Screen Reached');

    // 4. Type the password and press Enter
    // TSO places the cursor precisely where it wants you to type the password.
    // Do NOT tab or home, just type it exactly where the cursor is.
    console.log('Entering password...');
    await ati.send('CUL8TR[enter]');
    dumpScreen('Sent Password, waiting for Welcome banner...');

    // 5. Wait for the Welcome Banner
    rc = await ati.wait(10, () => ati.scrhas('Welcome to the TSO system'));
    if (rc === 0) throw new Error('Timeout waiting for Welcome banner');
    dumpScreen('Welcome Banner Reached');

    // Press enter to clear the *** prompt
    console.log('Clearing *** prompt...');
    await ati.send('[enter]');

    // Wait for the next *** prompt (Fortune cookie)
    await ati.wait(5, () => ati.scrhas('***'));
    dumpScreen('Fortune cookie screen');
    
    console.log('Clearing fortune cookie prompt...');
    await ati.send('[enter]');

    // Wait for the ISPF Main Menu
    await ati.wait(10, () => ati.scrhas('Option ===>'));
    dumpScreen('Login Complete - At ISPF Main Menu!');

    // 6. Navigate into RFE (Option 1) to prove it works
    if (ati.scrhas('Option ===>')) {
      console.log('Entering Option 1 (RFE)...');
      await ati.send('1[enter]');
      
      await ati.wait(5, () => ati.scrhas('RFE Primary Option Menu', true));
      dumpScreen('Inside RFE Menu!');

      console.log('Exiting back to main menu (PF3)...');
      await ati.send('[pf3]');
      await ati.wait(5, () => ati.scrhas('Option ===>'));
      dumpScreen('Back at ISPF Main Menu');
    }

    // 7. Log out gracefully
    console.log('Logging out (Option X)...');
    await ati.send('X[enter]');
    
    // TSO might drop us to a READY prompt after ISPF exits
    await ati.wait(10, () => ati.scrhas('READY'));
    dumpScreen('Dropped out of ISPF, at READY prompt');

    // Send the final logoff command
    console.log('Sending logoff command...');
    await ati.send('LOGOFF[enter]');
    
    // Wait until we see the Logon prompt again
    await ati.wait(10, () => ati.scrhas('Logon ===>'));
    dumpScreen('Successfully logged off - back at Logon screen');

    console.log('\n✅ Automation script completed successfully.');

  } catch (err) {
    console.error('\n❌ Automation failed:', err);
    dumpScreen('Screen state at failure');
  } finally {
    console.log('Dropping session...');
    ati.dropSession();
  }
}

main().catch(console.error);
