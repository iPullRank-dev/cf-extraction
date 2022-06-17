const puppeterHelper = require('./helper/puppeteer.js')
var { Readability, isProbablyReaderable } = require('@mozilla/readability');
var { JSDOM } = require('jsdom');
const LanguageDetect = require('languagedetect');
const lngDetector = new LanguageDetect();

const winkNLP = require( 'wink-nlp' );
const model = require( 'wink-eng-lite-web-model' );
const nlp = winkNLP( model )
// Acquire "its" and "as" helpers from nlp.
const its = nlp.its;
const as = nlp.as;
// used for parts of speech
var posTagger = require( 'wink-pos-tagger' );
var tagger = posTagger();

function getReadingTime(seconds) {
  if (seconds > 59) {
    var minutes = Math.floor(seconds / 60);
    seconds = seconds - minutes * 60;
    return minutes + "m " + seconds + "s";
  } else {
    return seconds + "s";
  }
}

exports.puppeteerExtractor = async (req, res) => {
  let { browser, page } = await puppeterHelper.openConnection();
  try {
    let url = req.query.url || "";
    let keyword = req.query.keyword || ""
    keyword = keyword.toLowerCase()

    if (url == "") {
      res.status(403).send({ message: "No Url" });
    }

    if (keyword ==""){
      res.status(403).send({ message: "No Keyword" });
    }

    let response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    // domain
    const domain = (new URL(url)).hostname.replace('www.','');

    // hostname
    const { hostname } = new URL(url);

    // headers
    const headers = response.headers();

    // Extract Page <title>
    const title = await page.evaluate(() =>{
      if (document.querySelector("title")) {
        return document.querySelector("title").text;
      }
      return "";
    });

    // Extract <meta> description
    const description = await page.evaluate(() =>{
      if (document.querySelector('meta[name="description"]')) {
        return document.querySelector('meta[name="description"]').content;
      }
      return "";
    });

    // headings [h1-h6]
    const h1s = await page.evaluate(
      () => [...document.querySelectorAll('h1')].map(elem => elem.innerText.trim()))
    const h2s = await page.evaluate(
      () => [...document.querySelectorAll('h2')].map(elem => elem.innerText.trim()))
    const h3s = await page.evaluate(
      () => [...document.querySelectorAll('h3')].map(elem => elem.innerText.trim()))
    const h4s = await page.evaluate(
      () => [...document.querySelectorAll('h4')].map(elem => elem.innerText.trim()))
    const h5s = await page.evaluate(
      () => [...document.querySelectorAll('h5')].map(elem => elem.innerText.trim()))
    const h6s = await page.evaluate(
      () => [...document.querySelectorAll('h6')].map(elem => elem.innerText.trim()))

    // meta robots
    const robotstxtUrl = await page.evaluate(() => {
      const robotstxtLink = document.querySelector('meta[name=robots]');
      if(robotstxtLink) return robotstxtLink.content;
      return "" // window.location.href;
    });

    // canonical
    const canonicalUrl = await page.evaluate(() => {
      const canonicalLink = document.querySelector('link[rel=canonical]');
      if(canonicalLink) return canonicalLink.href;
      return "" // window.location.href;
    });

    // DOM
    const html = await page.evaluate(() => { return document.querySelector('html').outerHTML || "" })

    // Dump the DOM to be extracted
    var webdoc = new JSDOM(html, { url: url });

    // parse the main content from the page
    let article = new Readability(webdoc.window.document).parse();

    // extract text of main content
    let text = article.textContent

    // language detection
    let language = lngDetector.detect(text, 1)[0][0];

    // build link payload
    let links = await page.evaluate(async () => {
      var atags = document.querySelectorAll("a");
      let links = [];
      for await (atag of atags){
        var anchor = atag.textContent.replace(/\s+/g, ' ').trim() || ""
        var link = atag.href.replace(/\/$/, ""); // remove trailing slash
        var rel = atag.rel || ""
        if(anchor!==""){
          links.push({anchor:anchor, link:link, rel:rel});
        }
      }

      // calculate link status
      function calculateStats(host, links){
        let internal = 0;
        let external = 0;
        var urls = links.map((l) => l.link);
        let regex = new RegExp('^(?:(?:f|ht)tp(?:s)?\:)?//(?:[^\@]+\@)?([^:/]+)', 'im'),
        why = links.forEach((l,i) => {
          let url = l.link;
          let match = url.match(regex);
          let domain = ((match ? match[1].toString() : ((url.indexOf(':') < 0) ? host : ''))).toLowerCase();
          if(domain != host){
            external+=1;
          }else{
            internal+=1;
          }
        });

        return {
          total:urls.length,
          unique:[...new Set(urls)].length,
          internal:internal,
          external:external,
          all: links
        };
      }
      return calculateStats(window.location.hostname.toLowerCase(), links)
    })
    
    // dump text into winkjs for parsing
    let doc = nlp.readDoc( text );

    // build entities of page
    var entities = doc.entities().out(its.detail);

    // Counts
    var paragraphs = (article.content.match(/<p>/g) || []).length;
    var sentences = doc.sentences().length();
    var tokens = doc.tokens().length();
    var words = doc.tokens().filter( (token) => {
      return token.out(its.type) === 'word'
    }).length();
    let characters = article.textContent.length
    var seconds = Math.floor(words * 60 / 275);
    let readingTime = getReadingTime(seconds) 

    // basic stats of main content
    let stats = {
       characters,
       words,
       tokens,
       sentences,
       paragraphs,
       readingTime
    }

    // Extract keywords from URL
    let urlFreq = ([...new Set(new URL(url).pathname.toLowerCase().split(/-|\//gi).filter(Boolean))])

    // Word frequency
    var wordFreq = doc.tokens().filter((token) => {
      return token.out(its.type) === 'word' && !token.out(its.stopWordFlag);
    }).out(its.normal, as.freqTable);
    wordFreq = wordFreq.slice(0, 100)

    // Sentiment of each sentence from content
    var sentiments = [];
    doc.sentences().each((s) => {
      sentiments.push({
        sentence: s.out(),
        sentiment: s.out(its.sentiment),
        speech: tagger.tagSentence( s.out()) // lots more data, but not always needed
      })
    })

    // Calculate Sentence Sentiment
    let eachSentiment = sentiments.map((s) => s.sentiment)
    const avgSentiment = eachSentiment.reduce((a, b) => a + b, 0) / eachSentiment.length;

    // checks for if keywords is in various URI or elements
    let inDomain = domain.toLowerCase().includes(keyword)
    let inHostname = hostname.toLowerCase().includes(keyword)
    let inUrl = url.toLowerCase().includes(keyword)
    let inh1s = h1s.map((e) => e.toLowerCase()).map((e) => e.includes(keyword)).includes(true)
    let inh2s = h2s.map((e) => e.toLowerCase()).map((e) => e.includes(keyword)).includes(true)
    let inh3s = h3s.map((e) => e.toLowerCase()).map((e) => e.includes(keyword)).includes(true)
    let inh4s = h4s.map((e) => e.toLowerCase()).map((e) => e.includes(keyword)).includes(true)
    let inh5s = h5s.map((e) => e.toLowerCase()).map((e) => e.includes(keyword)).includes(true)
    let inh6s = h6s.map((e) => e.toLowerCase()).map((e) => e.includes(keyword)).includes(true)
    let inTitle = title.toLowerCase().includes(keyword)
    let inDescription = description.toLowerCase().includes(keyword)
    let inContent = text.toLowerCase().includes(keyword)
    let check = {
      inDomain,
      inHostname,
      inTitle,
      inDescription,
      inUrl,
      inh1s,
      inh2s,
      inh3s,
      inh4s,
      inh5s,
      inh6s,
      inContent
    }

    // payload
    let payload = {
      keyword,
      url,
      headers,
      robotstxtUrl,
      canonicalUrl,
      domain,
      hostname,
      urlFreq,
      title,
      description,
      check,
      links,
      // article, // see what was parsed from the page
      entities,
      h1s,
      h2s,
      h3s,
      h4s,
      h5s,
      h6s,
      language,
      stats,
      wordFreq,
      avgSentiment,
      sentiments,
    }

    res.status(200).send(payload);
  } catch (err) {
    res.status(500).send(err.message);
  } finally {
    await puppeterHelper.closeConnection(page, browser);
  }
};