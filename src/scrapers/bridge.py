import sys
import asyncio
import json
import os

try:
    from crawl4ai import AsyncWebCrawler
except ImportError:
    print(json.dumps({"error": "crawl4ai not installed in this environment"}))
    sys.exit(1)

async def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No URL provided"}))
        return

    url = sys.argv[1]
    
    # Script to extract all CSS rules AND fetch external stylesheets from within the browser
    css_script = """
    async function captureStyles() {
        const rules = [];
        const externalBodies = [];
        const urls = [];
        const sheets = Array.from(document.styleSheets);
        
        for (const sheet of sheets) {
            if (sheet.href) urls.push(sheet.href);
            try {
                // Tier 1: Try reading direct rules (same-origin only)
                const sheetRules = Array.from(sheet.cssRules || []).map(r => r.cssText);
                rules.push(...sheetRules);
            } catch (e) {
                // Tier 2: CORS blocked, attempt fetch FROM WITHIN THE BROWSER
                if (sheet.href) {
                    try {
                        const res = await fetch(sheet.href);
                        if (res.ok) {
                            const body = await res.text();
                            externalBodies.push(body);
                        }
                    } catch (fetchErr) {
                        // Truly blocked or offline
                    }
                }
            }
        }
        return JSON.stringify({
            css_text: rules,
            css_contents: externalBodies,
            stylesheet_urls: urls
        });
    }
    await captureStyles();
    """

    try:
        async with AsyncWebCrawler() as crawler:
            # Run the crawler with JS evaluation enabled and a premium UA
            result = await crawler.arun(
                url=url,
                js_code=css_script,
                wait_for="body",
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            
            if not result.success:
                print(json.dumps({
                    "success": False,
                    "error": str(result.error_message) if hasattr(result, 'error_message') else "Unknown error"
                }))
                return

            # Extract data from the JS execution result
            css_text = []
            stylesheet_urls = []
            if result.js_execution_result:
                try:
                    js_data = json.loads(result.js_execution_result)
                    
                    # Merge captured rules and full stylesheet bodies into one array
                    captured_rules = js_data.get("css_text", [])
                    captured_bodies = js_data.get("css_contents", [])
                    css_text = captured_rules + captured_bodies
                    
                    stylesheet_urls = js_data.get("stylesheet_urls", [])
                except:
                    pass

            output = {
                "success": True,
                "markdown": result.markdown,
                "html": result.html,
                "css_text": css_text,
                "stylesheet_urls": stylesheet_urls,
                "title": "", # Will be extracted from HTML in Node.js
            }
            
            print(json.dumps(output))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    # Ensure stdout is UTF-8
    if sys.platform != "win32":
        import codecs
        sys.stdout = codecs.getwriter("utf-8")(sys.stdout.detach())

    asyncio.run(main())
