
const html = `<link rel="stylesheet" media="all" href="/sites/default/files/css/css_tzgyDz9ns2rpxNTJguSc-ZKazfO45mNgrLDmtLGruBY.css?delta=3&amp;language=en&amp;theme=iru4&amp;include=eJxtkM2OQyEIhV_IajLp-xhU0kuKYkA7uX363p9F28wsOJx8B1iQGczWkMDQ5dNXNIMbmsuiGJpoBaYnOtIZ0hxDmvmzX7pSBV2PKIPKNOQthNZQ_c-Bt_JJZNhQ6Du57uj6zaIhaF7C27o7b_fCoZ_-Ig9UpYKug8Jt218sFJ0d2L-Jn63PxGQLFmdUO2Ps0mePiSXfLfzDnEkm4FixEESmto_9QX4sWNHZagPr-bYH4a-FQ32VMhlfgZiFQQ">`;
const baseUrl = "https://www.iru.org/";

function extractStylesheetUrls(html, baseUrl) {
  const base = new URL(baseUrl);
  const decode = (str) => str.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  const linkRe = /<link[^>]+>/gi;
  const relRe = /rel=["'](?:[^"']+\s+)?stylesheet(?:\s+[^"']*)?["']/i;
  const hrefRe = /href=["']([^"']+)["']/i;

  const urls = [];
  for (const link of html.matchAll(linkRe)) {
    const tag = link[0];
    if (relRe.test(tag)) {
      const hrefMatch = tag.match(hrefRe);
      if (hrefMatch?.[1]) {
        try {
          urls.push(new URL(decode(hrefMatch[1]), base).href);
        } catch(e) { console.log(e) }
      }
    }
  }
  return urls;
}

console.log("Found:", JSON.stringify(extractStylesheetUrls(html, baseUrl), null, 2));
