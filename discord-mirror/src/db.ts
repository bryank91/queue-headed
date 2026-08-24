import { Message } from "discord.js-selfbot-v13"
import * as duckdb from "duckdb"
import { Config } from "./config"

export function create(dbDirectory: string) {
    return new duckdb.Database(dbDirectory, {
        "access_mode": "READ_WRITE"
    }, (err) => {
        if (err) {
            console.error(err)
        }
    })
}

export function setup(config: Config) {
    const db = create(config.getDb())
    return db
}

export function addMessage(db: duckdb.Database, message: Message) {
    const userId = message.author.username
    const text = message.content.replace(/'/g, '').replace(/;/g, '').replace(/"/g, ''); // remove injections and quotes
    db.all(`INSERT INTO DAILYCLACKMESSAGE (USERID, MESSAGE, datetime) values ('${userId}', '${text}', CAST(NOW() AS DATETIME))`, function(err, res) {
        if(err) {
            console.error(err)
        }
        console.log(res[0])
    })
}
