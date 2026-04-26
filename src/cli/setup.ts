#!/usr/bin/env node
import { execSync } from "child_process";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { homedir } from "os";

async function runSetup() {
  const baseDir = join(homedir(), ".reconstruct");
  const venvDir = join(baseDir, "venv");
  const pythonBin = process.platform === "win32" ? join(venvDir, "Scripts", "python.exe") : join(venvDir, "bin", "python");
  const pipBin = process.platform === "win32" ? join(venvDir, "Scripts", "pip.exe") : join(venvDir, "bin", "pip");

  console.log("🚀 Starting Reconstruct Local Setup...");

  try {
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }

    // 1. Check for python3
    try {
      execSync("python3 --version");
    } catch {
      console.error(" Error: python3 not found. Please install Python 3.10+ and try again.");
      process.exit(1);
    }

    // 2. Create venv if not exists
    if (!existsSync(venvDir)) {
      console.log(" Creating virtual environment...");
      execSync(`python3 -m venv "${venvDir}"`);
    } else {
      console.log(" Virtual environment already exists.");
    }

    // 3. Install crawl4ai
    console.log("Installing crawl4ai (this may take a minute)...");
    execSync(`"${pipBin}" install crawl4ai`);

    // 4. Install playwright browsers
    console.log("Installing Playwright browsers...");
    execSync(`"${pythonBin}" -m playwright install chromium`);

    // 5. Update config to mark setup as complete
    const configPath = join(baseDir, "config.json");
    let config: any = {};
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, "utf-8"));
      } catch {
        config = {};
      }
    }
    
    config.scrapers = {
      ...(config.scrapers || {}),
      local_setup_complete: true,
      crawl4ai_venv_path: venvDir,
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    console.log(" Local setup complete!");
    console.log(`Venv location: ${venvDir}`);
    console.log("You can now use high-fidelity local scraping with Crawl4AI.");

  } catch (err) {
    console.error(`\ Setup failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

runSetup();
