const Imap = require('imap');
const inspect = require('util').inspect;
require('dotenv').config()
const moment = require('moment')
const quoted = require('quoted-printable')




class IMAPWrapper {
  constructor(imap, onDone) {
    this.imap = imap
    this.box = undefined
    imap.once('ready', () => {
      imap.openBox("INBOX", true, (err, box) => {
        if (err) throw err;
        this.box = box;

        onDone()
      })
    })
  }

  lookupPartID(uid, partID) {
    const fetch = this.imap.fetch([uid], {
      bodies: [
        partID,
      ],
      struct: true
    })

    return new Promise((resolve, reject) => {
      fetch.on('message', function (msg, seqno) {

        msg.on('body', function (stream, info) {

          var buffer = '';

          stream.on('data', function (chunk) {

            buffer += chunk.toString('utf8');
          });
          stream.once('end', function () {
            resolve(quoted.decode(buffer))
          });
        });


      });
      fetch.once('error', function (err) {
        console.log('Fetch error: ' + err);
        reject(err)
      });
    })
  }

  _lookupByUIDForPartID(uid) {
    const fetch = this.imap.fetch([uid], {
      bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
      struct: true
    })
    return new Promise((resolve, reject) => {
      fetch.on('message', function (msg, seqno) {

        msg.once('attributes', function (attrs) {


          const { struct } = attrs;

          const isPlaintext = ({ type, subtype }) => type === 'text' && subtype === 'plain';

          // fk it, flat 10 deep because idk how deep it can be
          const parts = struct.flat(10)

          const plaintextPart = parts.find(isPlaintext)

          if (plaintextPart) {
            return resolve(plaintextPart.partID)
          }
          reject(new Error(`Could not find a plaintext part for ${uid}`))
        });

      });
      fetch.once('error', function (err) {
        console.log('Fetch error: ' + err);
        reject(err)
      });
    })
  }

  _waitForEmailTo(toEmail, {
    maxWait = 2 * 60 * 1000,
    pollRate = 5 * 1000,
    startTime,
    resolve,
    reject,
  } = {}) {
    const now = Date.now()

    console.count(toEmail)
    // expired?
    if (startTime + maxWait < now) {
      return reject(new Error("Did not receive any messages in time"))
    }

    this.imap.search([['TO', toEmail]], async (err, uids) => {
      if (err) {
        return reject(err)
      }

      // no messages, poll again
      if (uids.length === 0) {
        return setTimeout(() => {
          this._waitForEmailTo(toEmail, {
            maxWait, pollRate, startTime, resolve, reject
          })
        }, pollRate)
      }
      console.log({uids})

      const uid = uids[0]

      const partID = await this._lookupByUIDForPartID(uid)
      const part = await this.lookupPartID(uid, partID)

      const regex = /https:\/\/.*/
      const result = regex.exec(part)

      if(!result) {
        return reject(new Error(`Could not extract URL for uid: ${uid}, part: ${partID}`))
      }
      resolve(result[0])
    })
  }

  end() {
    this.imap.end()
  }

  waitForEmailTo(toEmail, {
    maxWait = 2 * 60 * 1000,
    pollRate = 5 * 1000,
  } = {}) {
    return new Promise((resolve, reject) => {
      this._waitForEmailTo(toEmail, {
        maxWait,
        pollRate,
        reject,
        resolve,
        startTime: Date.now()
      })
    })
  }


}


module.exports = ({ user, password, host, port }) => {

  const imap = new Imap({
    user,
    password,
    host,
    port,
    tls: true
  });

  imap.once('error', function (err) {
    console.log(err);
    throw err;
  });

  imap.once('end', function () {
    console.log('Connection ended');
    throw err;
  });


  return new Promise((resolve, reject) => {
    const wrapper = new IMAPWrapper(imap, () => {
      resolve(wrapper)
    })
    imap.connect()
  })
}


