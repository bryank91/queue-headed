import path from "path";
import { MirrorClient } from "./client";
import { Config } from "./config";
import { setup } from "./db";

const config = new Config(path.resolve(__dirname, "..", "config.yml"));
const db = setup(config)
const client = new MirrorClient(config, db);
client.login(config.getToken());
