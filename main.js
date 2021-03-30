const faker = require('faker')
const moment = require('moment')
require('dotenv').config()

const path = require('path')
const AVATAR_FILEPATH = path.join(__dirname, 'nothappy.png')


const imapConnect = require('./imap');


// puppeteer-extra is a drop-in replacement for puppeteer,
// it augments the installed puppeteer with plugin functionality
const puppeteer = require('puppeteer-extra')

// add stealth plugin and use defaults (all evasion techniques)
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())


// add recaptcha plugin
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha')
puppeteer.use(
  RecaptchaPlugin({
    provider: {
      id: '2captcha',
      token: process.env['2CAPTCHA_TOKEN']
    },
    visualFeedback: true, // colorize reCAPTCHAs (violet = detected, green = solved)
  })
)

puppeteer.use(require('puppeteer-extra-plugin-user-preferences')({
  userPrefs: {
    custom_handlers :{
      registered_protocol_handlers: [],
      ignored_protocol_handlers: ["discord"]
    }
  }
}))

const generator = () => {

  const dob = moment(faker.date.past(20, '2000-01-01'))
  return {
    email: `manny@${faker.random.alphaNumeric(10)}.${process.env.EMAIL_SUFFIX}`,
    username: faker.commerce.productName(),
    password: 'Npe3No%o!p3#2Qbr*pFp', // hardcoded password for all accounts, it's ok
    birthday: {
      month: dob.format("MMMM"),
      day: dob.format('D'),
      year: dob.format('YYYY'),
    }
  }

}

const selectors = {
  CAPTCHA_XPATH: '//*[@id="app-mount"]/div[2]/div/div[2]/div/section/div/div[1]',
  RATE_LIMIT_TEXT_XPATH: '//*[@id="app-mount"]/div[2]/div/div[2]/div/form/div/div[2]/div[6]',
  CLOSE_POPUP_BTN: '[aria-label=\"Close\"]',
  ACCEPT_INVITE_BTN: '[type=button]',
  HCAPTCHA_DIV: 'div[id^="hcaptcha"]',
  SETTINGS_BTN: '[aria-label="User Settings"]',
  AVATAR_CHANGE_FILE_INPUT_XPATH: '//*[@id="app-mount"]/div[2]/div/div[2]/div[2]/div/div[2]/div/div/main/div/div[1]/div/div/div[1]/div[1]/div/input',
  AVATAR_CHANGE_APPLY_BTN_XPATH: '//*[@id="app-mount"]/div[6]/div[2]/div/div/div[2]/button[2]',
  SETTINGS_SAVE_BTN_XPATH: '//*[@id="app-mount"]/div[2]/div/div[2]/div[2]/div/div[2]/div[2]/div/div/div[2]/button[2]'
}

const checkForRateLimit = async (page) => {
  let hasRateLimit = true;
  let hadRateLimit = false;
  // give the rate limit text time to pop up...
  await page.waitForTimeout(1000)
  while(hasRateLimit){
    try {
      console.log("Waiting to see if rate-limited...")
      const rateLimit = await page.waitForXPath(selectors.RATE_LIMIT_TEXT_XPATH, {
        timeout: 3*1000
      })
      const text = await rateLimit.evaluate(node => node.innerText)

      hasRateLimit = text === "You are being rate limited."
      hadRateLimit = hadRateLimit || hasRateLimit

      if(hasRateLimit) {
        await page.waitForTimeout(3000)
      }
    } catch (err) {
      console.error(err)
    }
  }

  if(hadRateLimit) {
    await page.keyboard.press('Enter')
  }
}

// puppeteer usage as normal
puppeteer.launch({ headless: false }).then(async browser => {
  let imap;
  try {



    // connect to email server and wait for later
    imap = await imapConnect({
      user: process.env.IMAP_USER,
      password: process.env.IMAP_PASS,
      host: process.env.IMAP_HOST,
      port: process.env.IMAP_PORT,
    })


    while (true) {
      const context = await browser.createIncognitoBrowserContext();
      const page = await context.newPage();



      // on joining a server, it'll prompt to launch discord, don't
      page.on('dialog', async dialog => {
        console.log(dialog.message());
        await dialog.dismiss();
      });
      console.log("Loading register page")

      await page.goto('https://discord.com/register')
      await page.waitForTimeout(5000)

      const data = generator()

      await page.focus("input")

      await page.keyboard.type(data.email, { delay: 100 })
      await page.keyboard.press('Tab')

      await page.keyboard.type(data.username, { delay: 100 })
      await page.keyboard.press('Tab')

      await page.keyboard.type(data.password, { delay: 100 })
      await page.keyboard.press('Tab')

      await page.keyboard.type(data.birthday.month, { delay: 100 })
      await page.keyboard.press('Tab')

      await page.keyboard.type(data.birthday.day, { delay: 100 })
      await page.keyboard.press('Tab')

      await page.keyboard.type(data.birthday.year, { delay: 100 })
      await page.keyboard.press('Tab')

      await page.keyboard.press('Enter')

      await checkForRateLimit(page)

      console.log("Checking for captcha")
      await page.waitForXPath(selectors.CAPTCHA_XPATH, {
        timeout: 2 * 60 * 1000
      })

      console.log("Solving Captcha")
      await page.solveRecaptchas()

      console.log("Waiting for main discord landing")
      await Promise.all([
        page.waitForNavigation({
          timeout: 2 * 60 * 1000
        }),
      ])

      // fire this now to be in the bg
      const emailPromise = imap.waitForEmailTo(data.email)

      // and now let's actually wait for it
      console.log("Waiting for verification email")
      const verifyLink = await emailPromise

      console.log("Verifying...")
      await page.goto(verifyLink)

      await page.waitForTimeout(3000)

      // load & accept the invite
      console.log("Joining hub")
      await page.goto(process.env.DISCORD_HUB_INVITE)

      await page.waitForSelector(selectors.ACCEPT_INVITE_BTN)
      await page.click(selectors.ACCEPT_INVITE_BTN)

      console.log("Waiting for invite load")
      await page.waitForNavigation()
      await page.waitForTimeout(5000)


      const popupButtonPt2 = await page.$(selectors.CLOSE_POPUP_BTN)
      if (popupButtonPt2) {
        console.log("Closing Discord Popup")
        await popupButtonPt2.click()
      }

      await page.waitForTimeout(3000)

      console.log("Opening Settings")
      // and let's change our avatar to not be caught so easily
      await page.waitForSelector(selectors.SETTINGS_BTN)
      await page.click(selectors.SETTINGS_BTN)

      // upload the file
      console.log("Selecting Avatar")
      const avaterInput = await page.waitForXPath(selectors.AVATAR_CHANGE_FILE_INPUT_XPATH)

      await avaterInput.uploadFile(AVATAR_FILEPATH)
      // wait for it to parse or something...
      await page.waitForTimeout(3000)

      // now some popup shows up to apply the zoom thing
      console.log("Applying Crop Settings")
      const avatarChangeApplyBtn = await page.waitForXPath(selectors.AVATAR_CHANGE_APPLY_BTN_XPATH)
      await avatarChangeApplyBtn.click()

      console.log("Waiting to appease discord...")
      await page.waitForTimeout(3000)

      // and now let's save the avatar
      console.log("Applying avatar changes")
      const settingsSaveBtn = await page.waitForXPath(selectors.SETTINGS_SAVE_BTN_XPATH)
      await settingsSaveBtn.click()

      await page.waitForTimeout(500)
      await context.close()
    }
  } catch (err) {
    await page.screenshot({ path: 'error.png', fullPage: true })
    console.error(err)
  } finally {
    imap.end()
  }
})


