import { Ati } from "./src/automation/ati";

const ITERATIONS = 100;

async function runWorker(workerId: number, user: string, pass: string) {
  const ati = new Ati();

  // Make the wait loop check the screen every 50ms
  ati.set("WAITSLEEP", 0.05);

  try {
    console.log(`[Worker ${workerId} | ${user}] Connecting to mainframe...`);
    await ati.connectSession(`TK4_${workerId}`, {
      host: "127.0.0.1",
      port: 3270,
      useTn3270e: true,
      terminalType: "IBM-3278-2-E",
    });

    // Wait for the connection to settle (wait up to 5 seconds for Hercules Version OR Logon ===>)
    await ati.wait(
      5,
      () => ati.scrhas("Hercules Version") || ati.scrhas("Logon ===>"),
    );

    // If we are on the splash screen, clear it
    if (ati.scrhas("Hercules Version")) {
      await ati.send("[enter]");
      await ati.wait(10, () => !ati.scrhas("Hercules Version"));
    }

    console.log(
      `[Worker ${workerId} | ${user}] Connected. Starting ${ITERATIONS} cycles...`,
    );

    for (let i = 1; i <= ITERATIONS; i++) {
      // Wait for Logon prompt
      let rc = await ati.wait(10, () => ati.scrhas("Logon ===>"));

      // If we timed out and the screen is blank or says "INPUT NOT RECOGNIZED",
      // try sending [clear] to force VTAM to repaint the logon screen
      if (rc === 0) {
        await ati.send("[clear]");
        rc = await ati.wait(5, () => ati.scrhas("Logon ===>"));
        if (rc === 0)
          throw new Error(
            "Timeout waiting for Logon prompt (even after [clear])",
          );
      }

      // Send Logon command
      await ati.send("[clear]");
      await ati.wait(2, () => ati.keyLock === false);
      await ati.send(`L ${user}[enter]`);

      // Enter password
      rc = await ati.wait(10, () => ati.scrhas("PASSWORD"));
      if (rc === 0) throw new Error("Timeout waiting for password prompt");
      await ati.send(`${pass}[enter]`);

      // Clear the two *** prompts (Welcome + Fortune Cookie)
      rc = await ati.wait(10, () => ati.scrhas("Welcome to the TSO system"));
      if (rc === 0) throw new Error("Timeout waiting for Welcome Banner");
      await ati.send("[enter]");

      rc = await ati.wait(10, () => ati.scrhas("***"));
      if (rc === 0) throw new Error("Timeout waiting for Fortune cookie");
      await ati.send("[enter]");

      // Wait for Main Menu
      rc = await ati.wait(10, () => ati.scrhas("Option ===>"));
      if (rc === 0) throw new Error("Timeout waiting for ISPF Menu");

      // Exit ISPF
      await ati.send("X[enter]");
      await ati.wait(10, () => ati.scrhas("READY"));

      // Logoff TSO
      await ati.send("LOGOFF[enter]");

      console.log(
        `[Worker ${workerId} | ${user}] Completed cycle ${i}/${ITERATIONS} ✅`,
      );
    }
  } catch (err) {
    console.error(`\n❌ [Worker ${workerId} | ${user}] FAILED:`, err);
    const tnz = ati.getTnz();
    if (tnz) {
      console.log(`\n--- Screen at failure [Worker ${workerId}] ---`);
      console.log(tnz.scrstr(0, 0, true));
      console.log("-------------------------\n");
    }
  } finally {
    console.log(`[Worker ${workerId} | ${user}] Closing connection...`);
    ati.dropSession();
  }
}

async function main() {
  const accounts = [
    { u: "HERC01", p: "CUL8TR" },
    // { u: 'HERC02', p: 'CUL8TR' }
  ];

  console.log(
    `🚀 Starting Concurrency Stress Test: ${accounts.length} workers, ${ITERATIONS} cycles each.\n`,
  );
  console.time("Total Concurrency Time");

  // Spawn all workers in parallel
  // Note: We create a distinct Ati instance for each worker inside the runWorker function
  // because Ati is stateful (currentSession, hitRow, hitCol, etc.)
  const workers = accounts.map((acc, idx) => runWorker(idx + 1, acc.u, acc.p));

  await Promise.all(workers);

  console.log("\n🏁 Concurrency stress test finished!");
  console.timeEnd("Total Concurrency Time");
}

main().catch(console.error);
