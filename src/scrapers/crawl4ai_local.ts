import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Crawl4AIPage {
  url: string;
  markdown: string;
  html: string;
  css_text: string[];
  stylesheet_urls: string[];
  error?: string;
  metadata?: any;
}

/**
 * Scrapes a URL using a local Crawl4AI installation.
 * Requires the setup tool (reconstruct_setup_local) to have been run.
 */
export async function scrapeWithCrawl4AI(
  url: string,
  options: { venvPath?: string; timeout_ms?: number } = {}
): Promise<Crawl4AIPage> {
  const venvPath = options.venvPath;
  
  if (!venvPath || !existsSync(venvPath)) {
    return {
      url,
      markdown: "",
      html: "",
      css_text: [],
      stylesheet_urls: [],
      error: "Crawl4AI virtual environment not found. Please run the 'reconstruct_setup_local' tool first.",
    };
  }

  const pythonBin = process.platform === "win32" 
    ? join(venvPath, "Scripts", "python.exe") 
    : join(venvPath, "bin", "python");
    
  const bridgeScript = join(__dirname, "bridge.py");

  return new Promise((resolve) => {
    const pyProcess = spawn(pythonBin, [bridgeScript, url]);
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      pyProcess.kill();
      resolve({
        url,
        markdown: "",
        html: "",
        css_text: [],
        stylesheet_urls: [],
        error: `Crawl4AI timed out after ${options.timeout_ms ?? 60000}ms`,
      });
    }, options.timeout_ms ?? 60000);

    pyProcess.stdout.on("data", (data) => (stdout += data.toString()));
    pyProcess.stderr.on("data", (data) => (stderr += data.toString()));

    pyProcess.on("close", (code) => {
      clearTimeout(timeout);
      
      if (code !== 0) {
        resolve({
          url,
          markdown: "",
          html: "",
          css_text: [],
          stylesheet_urls: [],
          error: stderr.trim() || `Python process exited with code ${code}`,
        });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          resolve({ url, markdown: "", html: "", css_text: [], stylesheet_urls: [], error: result.error });
        } else {
          resolve({
            url: result.url || url,
            markdown: result.markdown || "",
            html: result.html || "",
            css_text: result.css_text || [],
            stylesheet_urls: result.stylesheet_urls || [],
            metadata: result.metadata
          });
        }
      } catch (err) {
        resolve({
          url,
          markdown: "",
          html: "",
          css_text: [],
          stylesheet_urls: [],
          error: `Failed to parse Crawl4AI output: ${stdout.slice(0, 500)}...`,
        });
      }
    });
  });
}
