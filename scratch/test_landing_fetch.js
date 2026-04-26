async function test() {
  const url = "https://www.iru.com/";
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
  };
  console.log("Fetching Landing Page:", url);
  const res = await fetch(url, { headers });
  console.log("Status:", res.status);
  const body = await res.text();
  console.log("Body length:", body.length);
  console.log("Body snippet:", body.slice(0, 500));
}

test();
