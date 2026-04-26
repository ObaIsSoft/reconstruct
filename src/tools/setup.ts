import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execSync, spawn } from "child_process";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { homedir } from "os";

export function registerSetupTool(server: McpServer) {
  server.tool(
    "reconstruct_setup_local",
    "Installs local dependencies for high-fidelity scraping (Crawl4AI + Playwright). Warning: requires ~500MB disk space and Python 3.",
    {
      confirm: z.boolean().describe("Must be true to start installation"),
    },
    async ({ confirm }) => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: "Setup cancelled. Please set confirm=true to install local dependencies." }],
          isError: true,
        };
      }

      const baseDir = join(homedir(), ".reconstruct");
      const venvDir = join(baseDir, "venv");
      const pythonBin = process.platform === "win32" ? join(venvDir, "Scripts", "python.exe") : join(venvDir, "bin", "python");
      const pipBin = process.platform === "win32" ? join(venvDir, "Scripts", "pip.exe") : join(venvDir, "bin", "pip");

      try {
        if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });

        // 1. Check for python3
        try {
          execSync("python3 --version");
        } catch {
          return {
            content: [{ type: "text", text: "Error: python3 not found. Please install Python 3.10+ and try again." }],
            isError: true,
          };
        }

        const logs: string[] = ["Starting local setup..."];

        // 2. Create venv if not exists
        if (!existsSync(venvDir)) {
          logs.push("Creating virtual environment...");
          execSync(`python3 -m venv "${venvDir}"`);
        } else {
          logs.push("Virtual environment already exists.");
        }

        // 3. Install crawl4ai
        logs.push("Installing crawl4ai (this may take a minute)...");
        execSync(`"${pipBin}" install crawl4ai`);

        // 4. Install playwright browsers
        logs.push("Installing Playwright browsers...");
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

        writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
        logs.push(`Configuration saved to ${configPath}`);
        logs.push("Local setup complete!");
        logs.push(`Venv: ${venvDir}`);

        return {
          content: [{ type: "text", text: logs.join("\n") }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Setup failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );
}
