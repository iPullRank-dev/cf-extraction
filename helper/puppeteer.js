const puppeteer = require("puppeteer-extra");
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const stealth = StealthPlugin()
// Remove this specific stealth plugin from the default set
stealth.enabledEvasions.delete('user-agent-override')
puppeteer.use(stealth)

const PUPPETEER_OPTIONS = {
    headless: true,
    args: [
      '--no-sandbox',
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-setuid-sandbox",
      "--no-first-run",
      "--no-zygote",
      "--deterministic-fetch",
      "--blink-settings=imagesEnabled=false",
    ],
    slowMo: 0
  };

exports.openConnection = async () => {
    const browser = await puppeteer.launch(PUPPETEER_OPTIONS);
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36"
    );
    await page.setViewport({ width: 1680, height: 1050 });
    return { browser, page };
  };

exports.closeConnection = async (page, browser) => {
    page && (await page.close());
    browser && (await browser.close());
  };