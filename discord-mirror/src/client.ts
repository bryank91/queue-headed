import { Client, Message, PartialMessage, PresenceStatusData, TextChannel } from "discord.js-selfbot-v13";
import { Database } from "duckdb";
import { Config } from "./config";
import { Mirror, MirrorConfig } from "./mirror";
import { ToymateTrigger } from "./toymate-trigger";
import { isDirectMessage, isEmptyMessage, isSystemMessage, isVisibleOnlyByClient } from "./utils";

type ChannelId = string;

export class MirrorClient extends Client {
   private config: Config;
   private mirrorChannels: Map<ChannelId, Mirror> = new Map();
   private toymateTrigger: ToymateTrigger;

   public constructor(config: Config, db: Database) {
      super({checkUpdate: false});
      this.config = config;
      this.loadMirrors();
      this.toymateTrigger = new ToymateTrigger(config);

      this.on("ready", () => this.onReady());
      this.on("messageCreate", (message) => this.onMessageCreate(message, db));
      this.on("messageUpdate", (oldMessage, newMessage) => this.onMessageUpdate(oldMessage, newMessage, db));
   }

   private onReady(): void {
      this.user!.setStatus(this.config.getStatus() as PresenceStatusData);
      console.log(`${this.user?.username} is now mirroring >:)!`);
   }

   private onMessageCreate(message: Message, db: Database): void {
      this.toymateTrigger.handleMessage(message);
      this.mirrorMessage(message, db);
   }

   private onMessageUpdate(_oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage, db: Database): void {
      if (!newMessage.partial) {
         this.toymateTrigger.handleMessage(newMessage);
         this.mirrorMessage(newMessage, db);
      }
   }

   private mirrorMessage(message: Message, db: Database) {
      if (!this.isMirrorableMessage(message)) {
         return;
      }
      const mirror = this.mirrorChannels.get(message.channelId);
      if (!mirror) {
         return;
      }
      if (!mirror.messageMeetsMirrorCriteria(message)) {
         return;
      }
      if (!mirror.stripMessage(message)) {
         return;
      }
      mirror.applyReplacements(message);
      mirror.dispatchMessage(message, db, () => this.logMirroredMessage(message));

   }

   private isMirrorableMessage(message: Message): boolean {
      return !isSystemMessage(message) && !isDirectMessage(message) && !isVisibleOnlyByClient(message) && !isEmptyMessage(message);
   }

   private logMirroredMessage(message: Message): void {
      const logMessage = this.config.getLogMessage();
      if (!logMessage.length) {
         return;
      }

      console.log(logMessage
         .replace("%date%", new Date().toLocaleString())
         .replace("%author%", message.author.username ?? `<@${message.author.id}>`)
         .replace("%server%", message.guild!.name)
         .replace("%channel%", (message.channel as TextChannel).name)
      );

   }

   private loadMirrors(): void {
      for (const mirrorConfig of this.config.getMirrors()) {
         this.loadMirror(mirrorConfig);
      }
   }

   private loadMirror(mirrorConfig: MirrorConfig): void {
      const channelIds = mirrorConfig.channelIds;
      if (!channelIds) {
         return;
      }
      const mirror = new Mirror(mirrorConfig);
      for (const channelId of channelIds) {
         this.mirrorChannels.set(channelId, mirror);
      }
   }
}
