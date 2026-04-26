
async function testFetch() {
  const url = "https://www.iru.com/hubfs/iru-theme/css/main.css"; // example from iru.com
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/css,*/*;q=0.1"
  };

  try {
    console.log(`Fetching ${url}...`);
    const res = await fetch(url, { headers });
    console.log(`Status: ${res.status}`);
    console.log(`Content-Type: ${res.headers.get("content-type")}`);
    const body = await res.text();
    console.log(`Body length: ${body.length}`);
    console.log(`Body preview: ${body.slice(0, 500)}`);
  } catch (e) {
    console.error("Fetch failed:", e);
  }
}

testFetch();
