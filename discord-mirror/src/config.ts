import fs from "fs";
import path from "path";
import yaml from "yaml";
import { MirrorConfig } from "./mirror";

export interface ToymateNotificationConfig {
   enabled?: boolean;
   webhookUrls?: string[];
   postStarted?: boolean;
   postWaitingRoom?: boolean;
   postCleared?: boolean;
   postStopped?: boolean;
   postErrors?: boolean;
}

export interface ToymateTriggerConfig {
   enabled?: boolean;
   channelIds?: string[];
   authorIds?: string[];
   contentEquals?: string[];
   contentIncludes?: string[];
   regex?: string;
   cooldownSeconds?: number;
   watcherPath?: string;
   watcherConfigPath?: string;
   workingDirectory?: string;
   notifications?: ToymateNotificationConfig;
}

export class Config {
   private configPath: string;
   private token: string;
   private status: string;
   private logMessage: string;
   private db: string
   private mirrors: MirrorConfig[] = [];
   private toymateTrigger: ToymateTriggerConfig;

   public constructor(filePath: string) {
      this.configPath = path.resolve(filePath);
      const file = fs.readFileSync(this.configPath, "utf-8");
      const config = yaml.parse(file);

      this.token = config.token;
      this.status = config.status;
      this.logMessage = config.logMessage;
      this.db = config.db.directory

      for (const key in config.mirrors) {
         const mirror = config.mirrors[key];
         this.mirrors.push(mirror);
      }
      this.toymateTrigger = config.toymateTrigger ?? {};
   }

   public getToken(): string {
      return this.token;
   }

   public getStatus(): string {
      return this.status;
   }

   public getLogMessage(): string {
      return this.logMessage;
   }

   public getMirrors(): MirrorConfig[] {
      return this.mirrors;
   }

   public getDb(): string {
      return this.db
   }

   public getConfigDirectory(): string {
      return path.dirname(this.configPath);
   }

   public getToymateTrigger(): ToymateTriggerConfig {
      return this.toymateTrigger;
   }
}
